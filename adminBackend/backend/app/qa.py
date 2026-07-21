from __future__ import annotations

from typing import Any


def qa_surface(message: dict[str, Any]) -> str:
    explicit = str(message.get("surface") or "").strip().lower()
    if explicit in {"admin", "mobile"}:
        return explicit
    return "admin" if str(message.get("session_id") or message.get("sessionId") or "").strip() else "mobile"


def qa_message_matches_surface(message: dict[str, Any], requested_surface: str = "mobile") -> bool:
    surface = requested_surface if requested_surface in {"admin", "mobile"} else "mobile"
    return qa_surface(message) == surface


def qa_history_where_clause(surface: str = "mobile", favorite_only: bool = False) -> tuple[str, str, bool]:
    requested_surface = surface if surface in {"admin", "mobile"} else "mobile"
    return (
        """
        deleted_at IS NULL
        AND (
          surface = $2
          OR (
            COALESCE(surface, '') = ''
            AND (
              ($2 = 'admin' AND COALESCE(session_id, '') <> '')
              OR ($2 = 'mobile' AND COALESCE(session_id, '') = '')
            )
          )
        )
        AND ($3 = FALSE OR favorite = TRUE)
        """,
        requested_surface,
        favorite_only,
    )
