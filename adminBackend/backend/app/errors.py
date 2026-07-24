from __future__ import annotations

from typing import Any


def error_content(detail: Any, fallback: str = "请求失败") -> dict[str, Any]:
    if isinstance(detail, dict):
        message = str(detail.get("error") or detail.get("message") or fallback)
        payload = {"error": message}
        if detail.get("code"):
            payload["code"] = str(detail["code"])
        return payload
    return {"error": str(detail or fallback)}
