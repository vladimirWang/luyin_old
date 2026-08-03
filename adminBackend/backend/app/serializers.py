from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .qa import qa_surface


def iso(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return str(value)


def row_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def segment_speaker_key(segment: dict[str, Any]) -> str:
    return str(segment.get("speaker_label") or segment.get("speakerKey") or "speaker-1").strip() or "speaker-1"


def derive_speakers(recording: dict[str, Any], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    if not segments:
        totals["speaker-1"] = {
            "key": "speaker-1",
            "totalMs": int(recording.get("duration_ms") or 0),
            "segmentCount": 0,
            "positions": [],
        }
    for segment in segments:
        key = segment_speaker_key(segment)
        current = totals.setdefault(key, {"key": key, "totalMs": 0, "segmentCount": 0, "positions": []})
        start_ms = int(segment.get("start_ms") or 0)
        end_ms = int(segment.get("end_ms") or 0)
        current["totalMs"] += max(0, end_ms - start_ms)
        current["segmentCount"] += 1
        current["positions"].append({"startMs": start_ms, "endMs": end_ms})
    sorted_speakers = sorted(totals.values(), key=lambda item: (-item["totalMs"], -item["segmentCount"]))
    total_ms = sum(item["totalMs"] for item in sorted_speakers) or 1
    speaker_map = recording.get("speaker_map") or {}
    return [
        {
            "key": speaker["key"],
            "name": speaker_map.get(speaker["key"]) or (recording.get("speaker_name") if speaker["key"] == "speaker-1" else "") or f"说话人 {index + 1}",
            "totalMs": speaker["totalMs"],
            "segmentCount": speaker["segmentCount"],
            "percentage": round((speaker["totalMs"] / total_ms) * 1000) / 10,
            "positions": speaker["positions"],
        }
        for index, speaker in enumerate(sorted_speakers)
    ]


def public_segment(segment: dict[str, Any], speaker_name: str) -> dict[str, Any]:
    return {
        "id": segment["id"],
        "startMs": int(segment.get("start_ms") or 0),
        "endMs": int(segment.get("end_ms") or 0),
        "text": segment.get("text") or "",
        "speakerKey": segment_speaker_key(segment),
        "speakerName": speaker_name,
        "confidence": float(segment["confidence"]) if segment.get("confidence") is not None else None,
        "emotion": segment.get("emotion") or "中性",
        "event": segment.get("event") or "",
    }


def public_recording(recording: dict[str, Any], segments: list[dict[str, Any]]) -> dict[str, Any]:
    speakers = derive_speakers(recording, segments)
    speaker_by_key = {speaker["key"]: speaker for speaker in speakers}
    primary_speaker = speakers[0]["name"] if speakers else recording.get("speaker_name") or "说话人 1"
    transcript = []
    for segment in segments:
        speaker = speaker_by_key.get(segment_speaker_key(segment)) or {"name": primary_speaker}
        transcript.append(public_segment(segment, speaker["name"]))
    transcript_text = "\n".join(segment["text"] for segment in transcript)
    recording_id = recording["id"]
    tag = recording.get("tag") or ""
    tag_parts = [part.strip() for part in tag.split("/") if part.strip()]
    project_name = recording.get("folder_name") or (tag_parts[0] if len(tag_parts) > 1 else "")
    category = " / ".join(tag_parts[1:]) if len(tag_parts) > 1 else (tag_parts[0] if tag_parts else "普通录音")
    return {
        "id": recording_id,
        "seq": int(recording.get("seq") or 0),
        "name": recording.get("name") or "",
        "speakerName": primary_speaker,
        "speakerMap": recording.get("speaker_map") or {},
        "speakers": speakers,
        "tag": tag,
        "projectName": project_name,
        "category": category,
        "userId": recording.get("user_id"),
        "uploaderName": recording.get("uploader_name") or "",
        "uploaderDepartment": recording.get("uploader_department") or "",
        "uploaderCompany": recording.get("uploader_company") or "",
        "createdAt": iso(recording.get("created_at")),
        "updatedAt": iso(recording.get("updated_at")),
        "deletedAt": iso(recording.get("deleted_at")) or None,
        "durationMs": int(recording.get("duration_ms") or 0),
        "mimeType": recording.get("mime_type") or "application/octet-stream",
        "size": int(recording.get("file_size") or 0),
        "transcriptUrl": f"/admin-api/recordings/{recording_id}/transcript.txt" if recording.get("transcript_path") or segments else "",
        "favorite": bool(recording.get("favorite")),
        "folderId": recording.get("folder_id"),
        "status": recording.get("status") or "uploaded",
        "errorMessage": recording.get("error_message") or "",
        "transcriptText": transcript_text,
        "transcriptProvider": recording.get("transcript_provider") or "pending-python-asr",
        "transcriptSource": recording.get("transcript_source") or "",
        "transcribedAt": iso(recording.get("transcribed_at")),
        "summary": recording.get("summary"),
        "summaryStatus": recording.get("summary_status") or "idle",
        "summaryProvider": recording.get("summary_provider") or "",
        "summarizedAt": iso(recording.get("summarized_at")),
        "summaryError": recording.get("summary_error") or "",
        "transcriptHealth": {
            "mode": recording.get("transcript_provider") or "mobile-service",
            "configured": True,
            "isFallback": False,
            "message": "录音转写由手机端服务统一处理。",
        },
        "audioUrl": f"/admin-api/recordings/{recording_id}/audio",
        "transcript": transcript,
    }


def public_folder(folder: dict[str, Any], count: int = 0) -> dict[str, Any]:
    return {
        "id": folder["id"],
        "name": folder.get("name") or "",
        "createdAt": iso(folder.get("created_at")),
        "updatedAt": iso(folder.get("updated_at")),
        "count": count,
    }


def public_qa_message(message: dict[str, Any], recording_names: dict[str, str] | None = None) -> dict[str, Any]:
    ids = [str(item) for item in (message.get("recording_ids") or []) if item]
    if not ids and message.get("recording_id"):
        ids = [message["recording_id"]]
    recording_names = recording_names or {}
    return {
        "id": message["id"],
        "recordingId": message.get("recording_id"),
        "recordingIds": ids,
        "recordingNames": [recording_names[item] for item in ids if item in recording_names],
        "surface": qa_surface(message),
        "sessionId": message.get("session_id") or "",
        "question": message.get("question") or "",
        "answer": message.get("answer") or "",
        "jumpToMs": int(message.get("jump_to_ms") or 0),
        "citations": message.get("citations") or [],
        "attachments": message.get("attachments") or [],
        "warning": message.get("warning_text") or "",
        "emptyReason": message.get("empty_reason") or "",
        "scope": message.get("scope_key") or "",
        "scopeLabel": message.get("scope_label") or "",
        "scopeTerms": message.get("scope_terms") or [],
        "contextRecordingIds": message.get("context_recording_ids") or [],
        "favorite": bool(message.get("favorite")),
        "deletedAt": iso(message.get("deleted_at")) or None,
        "createdAt": iso(message.get("created_at")),
        "updatedAt": iso(message.get("updated_at")),
    }


def public_qa_session(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": session["id"],
        "title": session.get("title") or "新建问答",
        "titleSource": session.get("title_source") or "system",
        "preview": session.get("preview") or "",
        "status": session.get("status") or "active",
        "recordingIds": [str(item) for item in (session.get("recording_ids") or []) if item],
        "scope": session.get("scope_json") or {},
        "model": session.get("model") or "",
        "promptVersion": session.get("prompt_version") or "",
        "count": int(session.get("message_count") or 0),
        "createdAt": iso(session.get("created_at")),
        "updatedAt": iso(session.get("updated_at")),
        "archivedAt": iso(session.get("archived_at")) or None,
        "deletedAt": iso(session.get("deleted_at")) or None,
    }
