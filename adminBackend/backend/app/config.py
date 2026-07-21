from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import timedelta, timezone, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ROOT_DIR = Path(__file__).resolve().parents[2]


def parse_env_line(line: str) -> tuple[str, str] | None:
    clean = line.strip()
    if not clean or clean.startswith("#") or "=" not in clean:
        return None
    key, value = clean.split("=", 1)
    key = key.strip()
    if not key:
        return None
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return key, value


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        parsed = parse_env_line(line)
        if not parsed:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


load_env_file(ROOT_DIR / ".env")


def env(name: str, fallback: str = "") -> str:
    return os.getenv(name, fallback).strip()


def env_list(name: str, fallback: str = "") -> list[str]:
    raw = env(name, fallback)
    return [item.strip() for item in raw.split(",") if item.strip()]


def env_int(name: str, fallback: int) -> int:
    try:
        return int(env(name, str(fallback)))
    except ValueError:
        return fallback


def env_bool(name: str, fallback: bool = False) -> bool:
    value = env(name, "1" if fallback else "0").lower()
    return value in {"1", "true", "yes", "on"}


def resolve_app_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT_DIR / path


def env_path(name: str, fallback: str | Path) -> Path:
    return resolve_app_path(env(name, str(fallback)))


def resolve_timezone(name: str) -> tzinfo:
    clean = str(name or "").strip() or "Asia/Shanghai"
    try:
        return ZoneInfo(clean)
    except ZoneInfoNotFoundError as error:
        # Windows does not ship the IANA database. Keep the China default usable
        # without adding a runtime dependency; other names must remain explicit.
        if clean == "Asia/Shanghai":
            return timezone(timedelta(hours=8), clean)
        if clean in {"UTC", "Etc/UTC"}:
            return timezone.utc
        raise ValueError(f"APP_TIMEZONE 无效或当前系统缺少该时区数据：{clean}") from error


@dataclass(frozen=True)
class Settings:
    host: str = env("HOST", "0.0.0.0")
    port: int = int(env("PORT", "8788") or 8788)
    database_url: str = env("DATABASE_URL")
    mysql_host: str = env("MYSQL_HOST")
    mysql_port: int = max(1, env_int("MYSQL_PORT", 3306))
    mysql_user: str = env("MYSQL_USER")
    mysql_password: str = os.getenv("MYSQL_PASSWORD", "")
    mysql_database: str = env("MYSQL_DATABASE")
    admin_username: str = env("ADMIN_USERNAME", "admin") or "admin"
    admin_password: str = os.getenv("ADMIN_PASSWORD", "")
    admin_password_sha256: str = env("ADMIN_PASSWORD_SHA256").lower()
    admin_session_secret: str = env("ADMIN_SESSION_SECRET")
    admin_session_ttl_hours: int = max(1, int(env("ADMIN_SESSION_TTL_HOURS", "12") or 12))
    mobile_api_key: str = env("MOBILE_API_KEY")
    admin_backend_api_key: str = env("ADMIN_BACKEND_API_KEY")
    mobile_internal_api_url: str = env("MOBILE_INTERNAL_API_URL", "http://127.0.0.1:8787/api/internal-admin").rstrip("/")
    auto_create_admin_schema: bool = env_bool("AUTO_CREATE_ADMIN_SCHEMA", False)
    admin_api_prefix: str = "/admin-api"
    cors_origins: list[str] = field(default_factory=lambda: env_list("CORS_ORIGINS"))
    storage_dir: Path = field(default_factory=lambda: env_path("STORAGE_DIR", ROOT_DIR / "backend" / "storage"))
    max_upload_bytes: int = max(1, env_int("MAX_UPLOAD_BYTES", 536_870_912))
    app_timezone_name: str = env("APP_TIMEZONE", "Asia/Shanghai") or "Asia/Shanghai"
    dist_dir: Path = field(default_factory=lambda: env_path("FRONTEND_DIST_DIR", ROOT_DIR / "dist"))
    schema_path: Path = ROOT_DIR / "backend" / "schema.admin.mysql.sql"
    asr_provider: str = env("ASR_PROVIDER", "pending-python-asr")
    llm_provider: str = env("LLM_PROVIDER", "")
    llm_api_url: str = env("LLM_API_URL", "")
    llm_api_key: str = env("LLM_API_KEY", "")
    llm_model: str = env("LLM_MODEL", "")
    llm_timeout_seconds: int = max(3, env_int("LLM_TIMEOUT_SECONDS", 60))
    llm_max_completion_tokens: int = max(512, env_int("LLM_MAX_COMPLETION_TOKENS", 2048))
    summary_api_url: str = env("SUMMARY_API_URL", "")
    summary_api_key: str = env("SUMMARY_API_KEY", "")
    summary_model: str = env("SUMMARY_MODEL", "")

    def __post_init__(self) -> None:
        resolve_timezone(self.app_timezone_name)

    @property
    def admin_configured(self) -> bool:
        return bool(self.admin_password or self.admin_password_sha256)

    @property
    def mysql_configured(self) -> bool:
        return bool(self.mysql_host and self.mysql_user and self.mysql_database)

    @property
    def database_configured(self) -> bool:
        return self.mysql_configured or self.database_url.lower().startswith(("mysql://", "mysql+aiomysql://"))

    @property
    def session_secret(self) -> str:
        return self.admin_session_secret or self.admin_password or self.admin_password_sha256

    @property
    def app_timezone(self) -> tzinfo:
        return resolve_timezone(self.app_timezone_name)

    @property
    def audio_dir(self) -> Path:
        return self.storage_dir / "audio"

    @property
    def transcript_dir(self) -> Path:
        return self.storage_dir / "transcripts"

    @property
    def tmp_dir(self) -> Path:
        return self.storage_dir / "tmp"


settings = Settings()
