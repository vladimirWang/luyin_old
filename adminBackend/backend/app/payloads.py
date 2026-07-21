from __future__ import annotations

from typing import Any


def provided_fields(payload: Any) -> set[str]:
    fields = getattr(payload, "model_fields_set", None)
    if fields is None:
        fields = getattr(payload, "__fields_set__", None)
    return set(fields or [])
