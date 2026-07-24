from __future__ import annotations

from contextlib import asynccontextmanager
import json
import re
from typing import Any, AsyncIterator
from urllib.parse import parse_qs, unquote, urlsplit
import warnings

import aiomysql
from fastapi import HTTPException

from .config import settings


JSON_COLUMNS = {
    "attachments",
    "citations",
    "context_recording_ids",
    "recording_ids",
    "scope_json",
    "scope_terms",
    "speaker_map",
    "summary",
}
PLACEHOLDER_RE = re.compile(r"\$(\d+)")

pool: aiomysql.Pool | None = None


def mysql_options() -> dict[str, Any] | None:
    if settings.mysql_configured:
        return {
            "host": settings.mysql_host,
            "port": settings.mysql_port,
            "user": settings.mysql_user,
            "password": settings.mysql_password,
            "db": settings.mysql_database,
            "charset": "utf8mb4",
        }

    url = settings.database_url
    if not url.lower().startswith(("mysql://", "mysql+aiomysql://")):
        return None
    parsed = urlsplit(url.replace("mysql+aiomysql://", "mysql://", 1))
    query = parse_qs(parsed.query)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "db": unquote(parsed.path.lstrip("/")),
        "charset": query.get("charset", ["utf8mb4"])[0],
    }


def prepare_query(sql: str, args: tuple[Any, ...]) -> tuple[str, tuple[Any, ...]]:
    ordered: list[Any] = []

    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1)) - 1
        if index < 0 or index >= len(args):
            raise ValueError(f"SQL placeholder {match.group(0)} has no matching argument")
        value = args[index]
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        ordered.append(value)
        return "%s"

    return PLACEHOLDER_RE.sub(replace, sql), tuple(ordered)


def decode_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    for column in JSON_COLUMNS.intersection(result):
        value = result[column]
        if isinstance(value, (str, bytes, bytearray)):
            try:
                result[column] = json.loads(value)
            except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
                pass
    return result


def split_sql_statements(script: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []
    quote = ""
    index = 0
    while index < len(script):
        char = script[index]
        next_char = script[index + 1] if index + 1 < len(script) else ""
        if not quote and char == "-" and next_char == "-":
            end = script.find("\n", index)
            index = len(script) if end == -1 else end
            continue
        if char in {"'", '"', "`"}:
            if quote == char:
                if next_char == char:
                    buffer.extend((char, next_char))
                    index += 2
                    continue
                quote = ""
            elif not quote:
                quote = char
        if char == ";" and not quote:
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
        else:
            buffer.append(char)
        index += 1
    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)
    return statements


class Transaction:
    def __init__(self, connection: "Connection") -> None:
        self.connection = connection

    async def __aenter__(self) -> "Transaction":
        await self.connection.raw.begin()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if exc_type is None:
            await self.connection.raw.commit()
        else:
            await self.connection.raw.rollback()


class Connection:
    def __init__(self, raw: aiomysql.Connection) -> None:
        self.raw = raw

    def transaction(self) -> Transaction:
        return Transaction(self)

    async def fetch(self, sql: str, *args: Any) -> list[dict[str, Any]]:
        query, params = prepare_query(sql, args)
        async with self.raw.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute(query, params)
            return [decode_row(row) or {} for row in await cursor.fetchall()]

    async def fetchrow(self, sql: str, *args: Any) -> dict[str, Any] | None:
        query, params = prepare_query(sql, args)
        async with self.raw.cursor(aiomysql.DictCursor) as cursor:
            await cursor.execute(query, params)
            return decode_row(await cursor.fetchone())

    async def fetchval(self, sql: str, *args: Any) -> Any:
        row = await self.fetchrow(sql, *args)
        return next(iter(row.values())) if row else None

    async def execute(self, sql: str, *args: Any) -> str:
        query, params = prepare_query(sql, args)
        async with self.raw.cursor() as cursor:
            await cursor.execute(query, params)
            command = query.lstrip().split(None, 1)[0].upper()
            return f"{command} {max(0, cursor.rowcount)}"

    async def executemany(self, sql: str, args: list[tuple[Any, ...]]) -> str:
        if not args:
            return "EXECUTEMANY 0"
        query, _ = prepare_query(sql, args[0])
        prepared = [prepare_query(sql, row)[1] for row in args]
        async with self.raw.cursor() as cursor:
            await cursor.executemany(query, prepared)
            return f"EXECUTEMANY {max(0, cursor.rowcount)}"


async def connect() -> None:
    global pool
    settings.audio_dir.mkdir(parents=True, exist_ok=True)
    settings.transcript_dir.mkdir(parents=True, exist_ok=True)
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    options = mysql_options()
    if not options:
        pool = None
        return
    pool = await aiomysql.create_pool(minsize=1, maxsize=10, autocommit=True, **options)
    if settings.auto_create_admin_schema:
        async with acquire() as connection:
            schema = settings.schema_path.read_text(encoding="utf-8")
            for statement in split_sql_statements(schema):
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", message="Table .* already exists")
                    warnings.filterwarnings("ignore", message="Duplicate entry .* for key .*PRIMARY.*")
                    await connection.execute(statement)


async def close() -> None:
    global pool
    if pool is not None:
        pool.close()
        await pool.wait_closed()
        pool = None


def is_connected() -> bool:
    return pool is not None and not pool.closed


@asynccontextmanager
async def acquire() -> AsyncIterator[Connection]:
    if pool is None:
        raise RuntimeError("MySQL connection pool is not ready")
    async with pool.acquire() as raw:
        yield Connection(raw)


async def db() -> AsyncIterator[Connection]:
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "MySQL 未配置：请设置 MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD 和 MYSQL_DATABASE",
                "code": "DATABASE_NOT_CONFIGURED",
            },
        )
    async with acquire() as connection:
        yield connection
