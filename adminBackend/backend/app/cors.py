from __future__ import annotations


def cors_options(origins: list[str]) -> dict[str, object]:
    if "*" in origins:
        return {
            "allow_origins": ["*"],
            "allow_credentials": False,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
        }
    return {
        "allow_origins": origins,
        "allow_credentials": bool(origins),
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
