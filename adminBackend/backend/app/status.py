from __future__ import annotations

from typing import Any


def service_health(settings: Any, database_connected: bool) -> dict[str, Any]:
    database_configured = bool(getattr(settings, "database_configured", getattr(settings, "database_url", "")))
    admin_configured = bool(settings.admin_configured)
    gateway_configured = bool(
        getattr(settings, "admin_backend_api_key", "")
        and getattr(settings, "mobile_internal_api_url", "")
    )
    cors_origins = list(getattr(settings, "cors_origins", []) or [])
    warnings: list[str] = []
    if not database_configured:
        warnings.append("MySQL 未配置，请设置 MYSQL_HOST、MYSQL_USER 和 MYSQL_DATABASE。")
    elif not database_connected:
        warnings.append("MySQL 连接池未就绪，请检查数据库连接和 FastAPI 启动日志。")
    if not admin_configured:
        warnings.append("管理员登录未配置，请设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256。")
    if not gateway_configured:
        warnings.append("手机端数据网关未配置，请设置 ADMIN_BACKEND_API_KEY 和 MOBILE_INTERNAL_API_URL。")

    admin_ready = database_configured and database_connected and admin_configured and gateway_configured
    return {
        "ready": admin_ready,
        "adminReady": admin_ready,
        "mobileReady": gateway_configured,
        "checks": {
            "database": {
                "configured": database_configured,
                "connected": database_connected,
            },
            "adminAuth": {
                "configured": admin_configured,
            },
            "mobileApi": {
                "configured": gateway_configured,
            },
            "dataGateway": {
                "configured": gateway_configured,
                "url": getattr(settings, "mobile_internal_api_url", ""),
            },
            "cors": {
                "sameOriginOnly": not cors_origins,
                "origins": cors_origins,
            },
            "timezone": {
                "name": getattr(settings, "app_timezone_name", "Asia/Shanghai"),
            },
            "asr": {"configured": True, "mode": "mobile-service"},
            "summary": {
                "configured": bool(settings.summary_model),
                "model": settings.summary_model,
            },
        },
        "warnings": warnings,
    }
