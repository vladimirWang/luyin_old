from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone, tzinfo
import re
from typing import Any


ALL_SCOPE_TERMS = ("全部", "所有", "历史", "全量", "整体", "所有会议", "全部录音")
METADATA_LABELS = {
    "folder": "项目",
    "speaker": "成员",
    "name": "录音",
}
DEFAULT_BUSINESS_TIMEZONE = timezone(timedelta(hours=8), "Asia/Shanghai")


@dataclass(frozen=True)
class ScopeResult:
    key: str
    label: str
    recordings: list[dict[str, Any]]


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).casefold()


def unique_ids(items: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        clean = str(item or "").strip()
        if clean and clean not in seen:
            seen.add(clean)
            result.append(clean)
    return result


def is_all_scope(question: str, requested_scope: str = "") -> bool:
    text = normalize_text(question)
    return str(requested_scope or "").strip().lower() == "all" or any(term in text for term in ALL_SCOPE_TERMS)


def _business_local(value: datetime, business_timezone: tzinfo) -> datetime:
    if value.tzinfo is not None:
        return value.astimezone(business_timezone).replace(tzinfo=None)
    return value


def _business_now(now: datetime | None, business_timezone: tzinfo) -> datetime:
    return _business_local(now, business_timezone) if now else datetime.now(business_timezone).replace(tzinfo=None)


def _day_start(value: datetime, business_timezone: tzinfo) -> datetime:
    return _business_local(value, business_timezone).replace(hour=0, minute=0, second=0, microsecond=0)


def _safe_date(year: int, month: int, day: int) -> datetime | None:
    try:
        return datetime(year, month, day)
    except ValueError:
        return None


def _date_scope(
    question: str,
    now: datetime | None = None,
    business_timezone: tzinfo = DEFAULT_BUSINESS_TIMEZONE,
) -> tuple[str, str, datetime, datetime] | None:
    reference = _business_now(now, business_timezone)
    today = _day_start(reference, business_timezone)
    text = normalize_text(question)

    explicit = re.search(r"(?:(20\d{2})[年./-])?(\d{1,2})[月./-](\d{1,2})[日号]?", text)
    if explicit:
        year = int(explicit.group(1) or reference.year)
        start = _safe_date(year, int(explicit.group(2)), int(explicit.group(3)))
        if start:
            return "date", start.strftime("%Y-%m-%d"), start, start + timedelta(days=1)

    if "前天" in text:
        start = today - timedelta(days=2)
        return "day-before-yesterday", "前天", start, start + timedelta(days=1)
    if "昨天" in text and "今天" in text:
        return "yesterday+today", "昨天和今天", today - timedelta(days=1), today + timedelta(days=1)
    if "昨天" in text:
        start = today - timedelta(days=1)
        return "yesterday", "昨天", start, start + timedelta(days=1)
    if any(term in text for term in ("上周", "上星期", "上个星期")):
        this_week = today - timedelta(days=today.weekday())
        start = this_week - timedelta(days=7)
        return "last-week", "上周", start, this_week
    if any(term in text for term in ("本周", "这周", "本星期", "这个星期")):
        start = today - timedelta(days=today.weekday())
        return "this-week", "本周", start, start + timedelta(days=7)
    if "今天" in text:
        return "today", "今天", today, today + timedelta(days=1)
    return None


def _created_at(recording: dict[str, Any], business_timezone: tzinfo) -> datetime | None:
    value = recording.get("created_at") or recording.get("createdAt")
    if isinstance(value, datetime):
        return _business_local(value, business_timezone)
    return None


def _in_range(recording: dict[str, Any], start: datetime, end: datetime, business_timezone: tzinfo) -> bool:
    created_at = _created_at(recording, business_timezone)
    return bool(created_at and start <= created_at < end)


def _speaker_map_values(recording: dict[str, Any]) -> list[str]:
    speaker_map = recording.get("speaker_map") or recording.get("speakerMap") or {}
    if not isinstance(speaker_map, dict):
        return []
    return [str(value or "").strip() for value in speaker_map.values() if str(value or "").strip()]


def _metadata_terms(recording: dict[str, Any]) -> list[tuple[str, str]]:
    tag_parts = [part.strip() for part in str(recording.get("tag") or "").split("/") if part.strip()]
    inferred_project = tag_parts[0] if len(tag_parts) > 1 else ""
    terms = [
        ("folder", recording.get("folder_name") or recording.get("folderName") or inferred_project or ("未分类项目" if not recording.get("folder_id") and not recording.get("folderId") else "")),
        ("name", recording.get("name") or ""),
        ("speaker", recording.get("uploader_name") or recording.get("uploaderName") or ""),
        ("speaker", recording.get("speaker_name") or recording.get("speakerName") or ""),
    ]
    terms.extend(("speaker", value) for value in _speaker_map_values(recording))
    result: list[tuple[str, str]] = []
    for kind, value in terms:
        clean = normalize_text(value)
        if len(clean) < 2 or clean.startswith("说话人") or clean.startswith("speaker-"):
            continue
        result.append((kind, str(value).strip()))
    return result


def _matched_metadata(question: str, recordings: list[dict[str, Any]]) -> tuple[dict[str, set[str]], list[str]]:
    text = normalize_text(question)
    matched: dict[str, set[str]] = {}
    labels: list[str] = []
    seen_labels: set[str] = set()
    for recording in recordings:
        for kind, value in _metadata_terms(recording):
            clean = normalize_text(value)
            if clean not in text:
                continue
            matched.setdefault(kind, set()).add(clean)
            label = f"{METADATA_LABELS[kind]}：{value}"
            if label not in seen_labels:
                labels.append(label)
                seen_labels.add(label)
    return matched, labels


def _matches_metadata(recording: dict[str, Any], matched: dict[str, set[str]]) -> bool:
    if not matched:
        return True
    terms_by_kind: dict[str, set[str]] = {}
    for kind, value in _metadata_terms(recording):
        terms_by_kind.setdefault(kind, set()).add(normalize_text(value))
    return all(terms_by_kind.get(kind, set()) & values for kind, values in matched.items())


def resolve_auto_scope(
    question: str,
    recordings: list[dict[str, Any]],
    now: datetime | None = None,
    business_timezone: tzinfo = DEFAULT_BUSINESS_TIMEZONE,
) -> ScopeResult:
    date_scope = _date_scope(question, now, business_timezone)
    metadata, metadata_labels = _matched_metadata(question, recordings)
    filtered = list(recordings)
    labels: list[str] = []
    key_parts: list[str] = []

    if date_scope:
        key, label, start, end = date_scope
        filtered = [recording for recording in filtered if _in_range(recording, start, end, business_timezone)]
        labels.append(label)
        key_parts.append(key)

    if metadata:
        filtered = [recording for recording in filtered if _matches_metadata(recording, metadata)]
        labels.extend(metadata_labels[:3])
        key_parts.append("metadata")

    if date_scope or metadata:
        return ScopeResult("+".join(key_parts), " + ".join(labels), filtered)

    today = _day_start(_business_now(now, business_timezone), business_timezone)
    return ScopeResult(
        "today",
        "今天（默认）",
        [recording for recording in recordings if _in_range(recording, today, today + timedelta(days=1), business_timezone)],
    )
