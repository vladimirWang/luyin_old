from __future__ import annotations

from typing import Any

from .qa import qa_surface


def has_explicit_recording_scope(payload: Any) -> bool:
    recording_ids = getattr(payload, "recordingIds", None) or []
    recording_id = getattr(payload, "recordingId", "") or ""
    return bool(recording_id.strip() or [item for item in recording_ids if str(item or "").strip()])


def ask_requires_admin(payload: Any) -> bool:
    surface = str(getattr(payload, "surface", "") or "").strip().lower()
    session_id = str(getattr(payload, "sessionId", "") or "").strip()
    scope = str(getattr(payload, "scope", "") or "").strip().lower()
    if surface == "admin" or session_id:
        return True
    if scope in {"all", "today", "admin"}:
        return True
    return not has_explicit_recording_scope(payload)


def qa_history_requires_admin(surface: str = "mobile") -> bool:
    return str(surface or "mobile").strip().lower() == "admin"


def qa_message_requires_admin(message: dict[str, Any]) -> bool:
    return qa_surface(message) == "admin"
