from __future__ import annotations

from typing import Any


MULTIPART_OVERHEAD_BYTES = 1_048_576
UPLOAD_PATHS = {"/admin-api/recordings", "/admin-api/recordings/segments"}


def format_bytes(value: int) -> str:
    if value >= 1024 * 1024:
        return f"{round(value / 1024 / 1024)}MiB"
    if value >= 1024:
        return f"{round(value / 1024)}KiB"
    return f"{value}B"


def upload_body_limit(max_upload_bytes: int) -> int:
    return max_upload_bytes + MULTIPART_OVERHEAD_BYTES


def should_check_upload_body(method: str, path: str) -> bool:
    return method.upper() == "POST" and path.rstrip("/") in UPLOAD_PATHS


def content_length_too_large(headers: Any, max_upload_bytes: int) -> bool:
    raw = headers.get("content-length") if headers else None
    if not raw:
        return False
    try:
        length = int(raw)
    except (TypeError, ValueError):
        return False
    return length > upload_body_limit(max_upload_bytes)


def upload_too_large_payload(max_upload_bytes: int) -> dict[str, str]:
    return {
        "error": f"上传文件超过大小上限（{format_bytes(max_upload_bytes)}）",
        "code": "UPLOAD_TOO_LARGE",
    }
