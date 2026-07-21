from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from http.cookies import SimpleCookie
from typing import Any

from fastapi import HTTPException, Request

from .config import settings


ADMIN_COOKIE_NAME = "wecom_admin_session"
MOBILE_API_KEY_HEADER = "x-mobile-api-key"


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify_admin_credentials(username: str, password: str) -> bool:
    if not settings.admin_configured:
        return False
    if not hmac.compare_digest((username or "").strip(), settings.admin_username):
        return False
    if settings.admin_password_sha256:
        return hmac.compare_digest(_sha256(password or ""), settings.admin_password_sha256)
    return hmac.compare_digest(password or "", settings.admin_password)


def _sign(payload: str) -> str:
    return _base64url(hmac.new(settings.session_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest())


def create_admin_session(username: str, now_ms: int | None = None) -> str:
    if not settings.admin_configured or not settings.session_secret:
        raise RuntimeError("管理员登录未配置")
    issued_at = now_ms if now_ms is not None else int(time.time() * 1000)
    payload = _base64url(json.dumps({
        "username": username,
        "expiresAt": issued_at + settings.admin_session_ttl_hours * 60 * 60 * 1000,
    }, separators=(",", ":")).encode("utf-8"))
    return f"{payload}.{_sign(payload)}"


def read_admin_session_cookie(cookie_header: str | None, now_ms: int | None = None) -> dict[str, Any] | None:
    if not settings.admin_configured or not settings.session_secret or not cookie_header:
        return None
    cookie = SimpleCookie()
    cookie.load(cookie_header)
    morsel = cookie.get(ADMIN_COOKIE_NAME)
    if not morsel:
        return None
    raw = morsel.value
    payload, dot, signature = raw.partition(".")
    if not dot or not payload or not signature:
        return None
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        session = json.loads(_decode_base64url(payload).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    if session.get("username") != settings.admin_username or int(session.get("expiresAt") or 0) <= now:
        return None
    return {"username": settings.admin_username, "expiresAt": session["expiresAt"]}


def admin_auth_status(request: Request) -> dict[str, Any]:
    session = read_admin_session_cookie(request.headers.get("cookie"))
    return {
        "configured": settings.admin_configured,
        "authenticated": bool(session),
        "user": {"username": settings.admin_username, "role": "admin"} if session else None,
    }


def verify_mobile_api_key(api_key: str | None) -> bool:
    return bool(settings.mobile_api_key) and hmac.compare_digest(api_key or "", settings.mobile_api_key)


def require_admin_session(request: Request) -> dict[str, Any]:
    if not settings.admin_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "管理员登录未配置，请设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256",
                "code": "ADMIN_AUTH_NOT_CONFIGURED",
            },
        )
    session = read_admin_session_cookie(request.headers.get("cookie"))
    if not session:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "请先登录管理员账号",
                "code": "ADMIN_AUTH_REQUIRED",
            },
        )
    return session


def require_shared_api_access(request: Request) -> dict[str, Any]:
    session = read_admin_session_cookie(request.headers.get("cookie"))
    if session:
        return {"type": "admin", **session}
    if verify_mobile_api_key(request.headers.get(MOBILE_API_KEY_HEADER)):
        return {"type": "mobile"}
    if not settings.mobile_api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "手机端 API Key 未配置，请设置 MOBILE_API_KEY",
                "code": "MOBILE_API_KEY_NOT_CONFIGURED",
            },
        )
    raise HTTPException(
        status_code=401,
        detail={
            "error": "请登录管理员账号或提供有效的手机端 API Key",
            "code": "SHARED_API_AUTH_REQUIRED",
        },
    )


def cookie_secure(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
