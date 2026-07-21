from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .access import ask_requires_admin, qa_history_requires_admin, qa_message_requires_admin
from .answers import LocalAnswerResult, local_answer_intro, no_context_warning, no_recordings_answer
from .cors import cors_options
from .database import Connection, close, connect, db, is_connected
from .errors import error_content
from .security import (
    ADMIN_COOKIE_NAME,
    admin_auth_status,
    cookie_secure,
    create_admin_session,
    require_admin_session,
    require_shared_api_access,
    verify_admin_credentials,
)
from .qa import qa_history_where_clause
from .scoping import is_all_scope, resolve_auto_scope, unique_ids
from .llm import PROMPT_VERSION, answer_meetings, generate_session_title, qa_config, qa_configured, title_from_intent
from .mobile_data import get_profile as get_mobile_profile
from .mobile_data import get_recording as get_mobile_recording
from .mobile_data import list_folders as list_mobile_folders
from .mobile_data import list_recordings as list_mobile_recordings
from .mobile_data import stream_recording_audio
from .serializers import public_folder, public_qa_message, public_qa_session, public_recording, row_dict
from .status import service_health
from .upload_limits import content_length_too_large, should_check_upload_body, upload_too_large_payload


app = FastAPI(title="Recording Admin API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    **cors_options(settings.cors_origins),
)


@app.middleware("http")
async def reject_oversized_upload_body(request: Request, call_next):
    if should_check_upload_body(request.method, request.url.path) and content_length_too_large(request.headers, settings.max_upload_bytes):
        return JSONResponse(status_code=413, content=upload_too_large_payload(settings.max_upload_bytes))
    return await call_next(request)


class LoginPayload(BaseModel):
    username: str = ""
    password: str = ""


class FolderPayload(BaseModel):
    name: str = ""


class RecordingPatchPayload(BaseModel):
    name: str | None = None
    speakerName: str | None = None
    speakerMap: dict[str, str] | None = None
    tag: str | None = None
    favorite: bool | None = None
    folderId: str | None = None


class AskPayload(BaseModel):
    question: str = ""
    recordingId: str = ""
    recordingIds: list[str] = []
    sessionId: str = ""
    scope: str = ""
    surface: str = ""
    attachments: list[dict[str, Any]] = []


class QaPatchPayload(BaseModel):
    favorite: bool | None = None


class QaSessionPatchPayload(BaseModel):
    title: str | None = None
    status: str | None = None


AdminSession = Annotated[dict[str, Any], Depends(require_admin_session)]
SharedAccess = Annotated[dict[str, Any], Depends(require_shared_api_access)]


@app.on_event("startup")
async def startup() -> None:
    await connect()


@app.on_event("shutdown")
async def shutdown() -> None:
    await close()


@app.exception_handler(HTTPException)
async def http_exception_to_error(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=error_content(exc.detail))


@app.exception_handler(FastAPIHTTPException)
async def fastapi_http_exception_to_error(request: Request, exc: FastAPIHTTPException) -> Response:
    if isinstance(exc.detail, (str, dict)):
        return JSONResponse(status_code=exc.status_code, content=error_content(exc.detail))
    return await http_exception_handler(request, exc)


def now_utc() -> datetime:
    return datetime.utcnow()


def sql_placeholders(count: int, start: int = 1) -> str:
    return ", ".join(f"${index}" for index in range(start, start + count))


def sanitize_ext(filename: str, content_type: str | None = None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix and re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        return suffix
    if content_type == "audio/mpeg":
        return ".mp3"
    if content_type == "audio/wav":
        return ".wav"
    if content_type == "audio/webm":
        return ".webm"
    if content_type == "video/mp4":
        return ".mp4"
    return ".bin"


async def save_upload(file: UploadFile, target: Path, max_bytes: int) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with target.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=upload_too_large_payload(max_bytes),
                    )
                handle.write(chunk)
    except Exception:
        if target.exists():
            target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    return size


def remove_file_if_exists(path: Path) -> None:
    if path.exists():
        path.unlink(missing_ok=True)


async def fetch_segments(connection: Connection, recording_id: str) -> list[dict[str, Any]]:
    del connection
    recording = await get_mobile_recording(recording_id)
    return list((recording or {}).get("transcript") or [])


async def fetch_recording(connection: Connection, recording_id: str) -> dict[str, Any] | None:
    del connection
    return await get_mobile_recording(recording_id)


async def fetch_recording_names(connection: Connection, ids: list[str]) -> dict[str, str]:
    del connection
    if not ids:
        return {}
    wanted = set(ids)
    rows = await list_mobile_recordings()
    return {row["id"]: row.get("name") or "" for row in rows if row.get("id") in wanted}


async def public_recording_by_id(connection: Connection, recording_id: str) -> dict[str, Any]:
    recording = await fetch_recording(connection, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="录音不存在")
    return public_recording(recording, await fetch_segments(connection, recording_id))


async def fetch_active_scope_recordings(connection: Connection) -> list[dict[str, Any]]:
    del connection
    return [row for row in await list_mobile_recordings() if not row.get("deleted_at")]


async def resolve_ask_scope(connection: Connection, payload: AskPayload) -> tuple[str, str, list[dict[str, Any]], list[str]]:
    selected_ids = unique_ids(payload.recordingIds or ([payload.recordingId] if payload.recordingId else []))
    if selected_ids:
        rows = await fetch_active_scope_recordings(connection)
        by_id = {row["id"]: row for row in rows}
        return "selected", "已手动选择", [by_id[item] for item in selected_ids if item in by_id], [item for item in selected_ids if item not in by_id]

    rows = await fetch_active_scope_recordings(connection)
    if is_all_scope(payload.question, payload.scope):
        return "all", "全部录音", rows, []

    scope = resolve_auto_scope(payload.question, rows, business_timezone=settings.app_timezone)
    return scope.key, scope.label, scope.recordings, []


async def build_local_answer(connection: Connection, question: str, recordings: list[dict[str, Any]]) -> LocalAnswerResult:
    if not recordings:
        return no_recordings_answer()

    citations: list[dict[str, Any]] = []
    answer_lines = local_answer_intro()
    context_ids: list[str] = []

    for recording in recordings[:8]:
        segments = list(recording.get("transcript") or [])
        summary = recording.get("summary") or {}
        snippet = ""
        if isinstance(summary, dict):
            snippet = str(summary.get("overview") or "")
        if not snippet and segments:
            snippet = " ".join(str(segment.get("text") or "") for segment in segments[:3]).strip()
        if snippet:
            context_ids.append(recording["id"])
            answer_lines.append(f"- {recording.get('name') or '未命名录音'}：{snippet[:220]}")
        else:
            answer_lines.append(f"- {recording.get('name') or '未命名录音'}：暂无可用转写或纪要。")

        if segments:
            first = segments[0]
            citations.append({
                "recordingId": recording["id"],
                "recordingName": recording.get("name") or "",
                "segmentId": first["id"],
                "startMs": int(first.get("start_ms") or 0),
                "endMs": int(first.get("end_ms") or 0),
                "text": first.get("text") or "",
            })

    warning = "" if context_ids else no_context_warning()
    if len(recordings) > 8:
        answer_lines.append(f"- 另有 {len(recordings) - 8} 条录音未展开展示。")
    return LocalAnswerResult(
        answer="\n".join(answer_lines),
        citations=citations,
        context_ids=context_ids,
        warning=warning,
        empty_reason="NO_CONTEXT" if warning else "",
    )


@app.get("/admin-api/admin/session")
async def admin_session(request: Request) -> dict[str, Any]:
    return admin_auth_status(request)


@app.post("/admin-api/admin/login")
async def admin_login(payload: LoginPayload, request: Request, response: Response) -> dict[str, Any]:
    if not settings.admin_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "管理员登录未配置，请设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_SHA256",
                "code": "ADMIN_AUTH_NOT_CONFIGURED",
            },
        )
    if not verify_admin_credentials(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="管理员账号或密码不正确")

    session = create_admin_session(settings.admin_username)
    response.set_cookie(
        ADMIN_COOKIE_NAME,
        session,
        max_age=settings.admin_session_ttl_hours * 60 * 60,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path="/",
    )
    return {"authenticated": True, "user": {"username": settings.admin_username, "role": "admin"}}


@app.post("/admin-api/admin/logout")
async def admin_logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(ADMIN_COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/admin-api/health")
async def health() -> dict[str, Any]:
    status = service_health(settings, is_connected())
    return {
        "ok": True,
        **status,
        "runtime": "fastapi",
        "storage": "mysql" if settings.database_configured else "mysql-not-configured",
        "transcribeMode": "mobile-service",
        "transcribeConfigured": True,
        "transcribeMessage": "录音转写由手机端服务统一处理。",
        "qaMode": "llm" if qa_configured() else "not-configured",
        "qa": {
            "configured": qa_configured(),
            "model": qa_config()["model"],
            "promptVersion": PROMPT_VERSION,
        },
        "summary": {
            "configured": bool(settings.summary_model),
            "model": settings.summary_model,
        },
    }


@app.get("/admin-api/transcription/status")
async def transcription_status() -> dict[str, Any]:
    return {"transcription": {"mode": "mobile-service", "configured": True, "message": "录音转写由手机端服务统一处理。"}}


@app.get("/admin-api/profile")
async def get_profile(_admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, Any]:
    del connection
    return await get_mobile_profile()


@app.get("/admin-api/folders")
async def list_folders(_access: SharedAccess, connection: Connection = Depends(db)) -> dict[str, Any]:
    del connection
    return await list_mobile_folders()


@app.post("/admin-api/folders", status_code=405)
async def create_folder(payload: FolderPayload, _admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, Any]:
    del payload, connection
    raise HTTPException(status_code=405, detail="项目分类请通过手机端服务修改")


@app.patch("/admin-api/folders/{folder_id}")
async def update_folder(folder_id: str, payload: FolderPayload, _admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, Any]:
    del folder_id, payload, connection
    raise HTTPException(status_code=405, detail="项目分类请通过手机端服务修改")


@app.delete("/admin-api/folders/{folder_id}")
async def delete_folder(folder_id: str, _admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, bool]:
    del folder_id, connection
    raise HTTPException(status_code=405, detail="项目分类请通过手机端服务修改")


@app.get("/admin-api/recordings")
async def list_recordings(
    _admin: AdminSession,
    q: str = "",
    folderId: str = "all",
    connection: Connection = Depends(db),
) -> dict[str, Any]:
    rows = await list_mobile_recordings()
    result = []
    for recording in rows:
        segments = list(recording.get("transcript") or [])
        item = public_recording(recording, segments)
        deleted = bool(item["deletedAt"])
        if folderId == "all" and deleted:
            continue
        if folderId == "favorites" and (not item["favorite"] or deleted):
            continue
        if folderId == "trash" and not deleted:
            continue
        if folderId == "uncategorized" and (item["folderId"] or deleted):
            continue
        if folderId not in {"all", "favorites", "trash", "uncategorized"} and (item["folderId"] != folderId or deleted):
            continue
        searchable = " ".join([
            item["name"],
            item["speakerName"],
            item["tag"],
            str(item["seq"]).zfill(3),
            item["transcriptText"],
        ]).lower()
        if q.strip() and q.strip().lower() not in searchable:
            continue
        result.append(item)
    return {"recordings": result}


@app.post("/admin-api/recordings", status_code=405)
async def create_recording(
    request: Request,
    _access: SharedAccess,
    audio: UploadFile = File(...),
    name: str = Form(""),
    folderId: str = Form(""),
    tag: str = Form(""),
    speakerName: str = Form(""),
    durationMs: int = Form(0),
    connection: Connection = Depends(db),
) -> dict[str, Any]:
    del request, audio, name, folderId, tag, speakerName, durationMs, connection
    raise HTTPException(status_code=405, detail="录音上传请调用手机端 /api/recordings 接口")


@app.post("/admin-api/recordings/segments", status_code=405)
async def create_recording_from_segments(_access: SharedAccess) -> dict[str, str]:
    raise HTTPException(status_code=405, detail="分片上传请调用手机端 /api/recordings/segments 接口")


@app.get("/admin-api/recordings/{recording_id}")
async def get_recording(recording_id: str, _access: SharedAccess, connection: Connection = Depends(db)) -> dict[str, Any]:
    return {"recording": await public_recording_by_id(connection, recording_id)}


@app.patch("/admin-api/recordings/{recording_id}")
async def update_recording(recording_id: str, payload: RecordingPatchPayload, _admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, Any]:
    del recording_id, payload, connection
    raise HTTPException(status_code=405, detail="录音信息请通过手机端 Prisma 服务修改")


@app.delete("/admin-api/recordings/{recording_id}")
async def delete_recording(recording_id: str, _admin: AdminSession, permanent: bool = False, connection: Connection = Depends(db)) -> dict[str, bool]:
    del recording_id, permanent, connection
    raise HTTPException(status_code=405, detail="录音删除请通过手机端 Prisma 服务执行")


@app.post("/admin-api/recordings/{recording_id}/restore")
async def restore_recording(recording_id: str, _admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, Any]:
    del recording_id, connection
    raise HTTPException(status_code=405, detail="录音恢复请通过手机端 Prisma 服务执行")


@app.get("/admin-api/recordings/{recording_id}/audio")
async def recording_audio(recording_id: str, _access: SharedAccess, connection: Connection = Depends(db)) -> StreamingResponse:
    del connection
    iterator, media_type, disposition = await stream_recording_audio(recording_id)
    return StreamingResponse(iterator, media_type=media_type, headers={"Content-Disposition": disposition})


@app.get("/admin-api/recordings/{recording_id}/transcript.txt")
async def recording_transcript_txt(recording_id: str, _access: SharedAccess, connection: Connection = Depends(db)) -> Response:
    recording = await fetch_recording(connection, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="录音不存在")
    segments = list(recording.get("transcript") or [])
    if not segments:
        raise HTTPException(status_code=404, detail="转写 TXT 不存在")
    text = "\n".join(f"[{segment.get('start_ms', 0)}] {segment.get('speaker_label') or 'speaker-1'}: {segment.get('text') or ''}" for segment in segments)
    return PlainTextResponse(text)


@app.post("/admin-api/recordings/{recording_id}/transcribe", status_code=405)
async def request_transcription(recording_id: str, _access: SharedAccess, connection: Connection = Depends(db)) -> dict[str, str | bool]:
    del recording_id, connection
    raise HTTPException(status_code=405, detail="转写任务请通过手机端服务发起")


@app.post("/admin-api/recordings/{recording_id}/summarize", status_code=405)
async def request_summary(recording_id: str, _admin: AdminSession, connection: Connection = Depends(db)) -> dict[str, str | bool]:
    del recording_id, connection
    raise HTTPException(status_code=405, detail="会议纪要请通过手机端服务生成")


@app.get("/admin-api/qa-messages")
async def list_qa_messages(
    request: Request,
    limit: int = 50,
    favorite: bool = False,
    surface: str = "mobile",
    connection: Connection = Depends(db),
) -> dict[str, Any]:
    if qa_history_requires_admin(surface):
        require_admin_session(request)
    else:
        require_shared_api_access(request)
    where_clause, requested_surface, favorite_only = qa_history_where_clause(surface, favorite)
    rows = [row_dict(row) for row in await connection.fetch(
        f"""
        SELECT * FROM admin_qa_messages
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT $1
        """,
        max(1, min(100, limit)),
        requested_surface,
        favorite_only,
    )]
    names = await fetch_recording_names(connection, sorted({item for row in rows for item in (row.get("recording_ids") or [])}))
    return {"messages": [public_qa_message(row, names) for row in rows]}


@app.get("/admin-api/qa-sessions")
async def list_qa_sessions(
    _admin: AdminSession,
    status: str = "active",
    limit: int = 50,
    connection: Connection = Depends(db),
) -> dict[str, Any]:
    if status not in {"active", "archived", "deleted"}:
        raise HTTPException(status_code=400, detail="无效的问答窗口状态")
    rows = [row_dict(row) for row in await connection.fetch(
        """
        SELECT s.*, count(q.id) AS message_count
        FROM admin_qa_sessions s
        LEFT JOIN admin_qa_messages q ON q.session_id = s.id AND q.deleted_at IS NULL
        WHERE s.surface = 'admin' AND s.status = $1
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        LIMIT $2
        """,
        status,
        max(1, min(100, limit)),
    )]
    return {"sessions": [public_qa_session(row) for row in rows]}


@app.patch("/admin-api/qa-sessions/{session_id}")
async def update_qa_session(
    session_id: str,
    payload: QaSessionPatchPayload,
    _admin: AdminSession,
    connection: Connection = Depends(db),
) -> dict[str, Any]:
    status = payload.status.strip().lower() if payload.status is not None else None
    if status is not None and status not in {"active", "archived", "deleted"}:
        raise HTTPException(status_code=400, detail="无效的问答窗口状态")
    title = payload.title.strip()[:80] if payload.title is not None else None
    if payload.title is not None and not title:
        raise HTTPException(status_code=400, detail="问答窗口标题不能为空")
    await connection.execute(
        """
        UPDATE admin_qa_sessions
        SET title = COALESCE($2, title),
            title_source = CASE WHEN $2 IS NULL THEN title_source ELSE 'manual' END,
            status = COALESCE($3, status),
            archived_at = CASE WHEN $3 = 'archived' THEN now() WHEN $3 = 'active' THEN NULL ELSE archived_at END,
            deleted_at = CASE WHEN $3 = 'deleted' THEN now() WHEN $3 = 'active' THEN NULL ELSE deleted_at END,
            updated_at = now()
        WHERE id = $1 AND surface = 'admin'
        """,
        session_id,
        title,
        status,
    )
    row = await connection.fetchrow("SELECT * FROM admin_qa_sessions WHERE id = $1 AND surface = 'admin'", session_id)
    if not row:
        raise HTTPException(status_code=404, detail="问答窗口不存在")
    return {"session": public_qa_session(row_dict(row))}


@app.delete("/admin-api/qa-sessions/{session_id}")
async def delete_qa_session(
    session_id: str,
    _admin: AdminSession,
    permanent: bool = False,
    connection: Connection = Depends(db),
) -> dict[str, bool]:
    if permanent:
        async with connection.transaction():
            await connection.execute("DELETE FROM admin_qa_messages WHERE session_id = $1", session_id)
            result = await connection.execute("DELETE FROM admin_qa_sessions WHERE id = $1 AND surface = 'admin'", session_id)
    else:
        result = await connection.execute(
            "UPDATE admin_qa_sessions SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1 AND surface = 'admin'",
            session_id,
        )
    if result.endswith("0"):
        raise HTTPException(status_code=404, detail="问答窗口不存在")
    return {"ok": True}


@app.get("/admin-api/qa-messages/{message_id}")
async def get_qa_message(message_id: str, request: Request, connection: Connection = Depends(db)) -> dict[str, Any]:
    row = await connection.fetchrow("SELECT * FROM admin_qa_messages WHERE id = $1 AND deleted_at IS NULL", message_id)
    if not row:
        raise HTTPException(status_code=404, detail="问答记录不存在")
    message = row_dict(row)
    if qa_message_requires_admin(message):
        require_admin_session(request)
    else:
        require_shared_api_access(request)
    names = await fetch_recording_names(connection, message.get("recording_ids") or [])
    return {"message": public_qa_message(message, names)}


@app.patch("/admin-api/qa-messages/{message_id}")
async def update_qa_message(message_id: str, payload: QaPatchPayload, request: Request, connection: Connection = Depends(db)) -> dict[str, Any]:
    current = await connection.fetchrow("SELECT surface, session_id FROM admin_qa_messages WHERE id = $1 AND deleted_at IS NULL", message_id)
    if not current:
        raise HTTPException(status_code=404, detail="问答记录不存在")
    if qa_message_requires_admin(row_dict(current)):
        require_admin_session(request)
    else:
        require_shared_api_access(request)
    await connection.execute(
        """
        UPDATE admin_qa_messages
        SET favorite = COALESCE($2, favorite), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        """,
        message_id,
        payload.favorite,
    )
    row = await connection.fetchrow("SELECT * FROM admin_qa_messages WHERE id = $1 AND deleted_at IS NULL", message_id)
    if not row:
        raise HTTPException(status_code=404, detail="问答记录不存在")
    message = row_dict(row)
    names = await fetch_recording_names(connection, message.get("recording_ids") or [])
    return {"message": public_qa_message(message, names)}


@app.delete("/admin-api/qa-messages/{message_id}")
async def delete_qa_message(message_id: str, request: Request, connection: Connection = Depends(db)) -> dict[str, bool]:
    current = await connection.fetchrow("SELECT surface, session_id FROM admin_qa_messages WHERE id = $1 AND deleted_at IS NULL", message_id)
    if not current:
        raise HTTPException(status_code=404, detail="问答记录不存在")
    if qa_message_requires_admin(row_dict(current)):
        require_admin_session(request)
    else:
        require_shared_api_access(request)
    result = await connection.execute(
        "UPDATE admin_qa_messages SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL",
        message_id,
    )
    if result.endswith("0"):
        raise HTTPException(status_code=404, detail="问答记录不存在")
    return {"ok": True}


@app.get("/admin-api/qa-messages/{message_id}/share.pdf")
async def qa_message_pdf(message_id: str, request: Request, connection: Connection = Depends(db)) -> PlainTextResponse:
    row = await connection.fetchrow("SELECT surface, session_id, question, answer FROM admin_qa_messages WHERE id = $1 AND deleted_at IS NULL", message_id)
    if not row:
        raise HTTPException(status_code=404, detail="问答记录不存在")
    if qa_message_requires_admin(row_dict(row)):
        require_admin_session(request)
    else:
        require_shared_api_access(request)
    raise HTTPException(status_code=501, detail="Python 后端暂未实现 PDF 导出，请先在中台查看问答内容。")


@app.post("/admin-api/ask")
async def ask_recordings(payload: AskPayload, request: Request, connection: Connection = Depends(db)) -> dict[str, Any]:
    if ask_requires_admin(payload):
        require_admin_session(request)
    else:
        require_shared_api_access(request)
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    if not qa_configured():
        raise HTTPException(status_code=503, detail="大语言模型尚未配置，请设置 LLM_API_URL、LLM_API_KEY 和 LLM_MODEL。")
    scope, label, recordings, missing_ids = await resolve_ask_scope(connection, payload)
    if (payload.recordingIds or payload.recordingId) and not recordings:
        raise HTTPException(status_code=404, detail="录音不存在")
    if not recordings:
        raise HTTPException(status_code=409, detail=f"{label}范围内没有可分析的录音，请调整录音范围后重试。")
    history = [row_dict(row) for row in await connection.fetch(
        """
        SELECT question, answer, scope_key, scope_label, recording_ids, created_at
        FROM admin_qa_messages
        WHERE session_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 8
        """,
        payload.sessionId[:80],
    )]
    history.reverse()
    segments_by_recording = {
        recording["id"]: list(recording.get("transcript") or [])
        for recording in recordings
    }
    try:
        llm_answer = await answer_meetings(question, recordings, segments_by_recording, history)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    warning = ""
    if missing_ids and recordings:
        warning = f"手动选择范围中有 {len(missing_ids)} 条录音已删除或不可用。"

    recording_ids = [recording["id"] for recording in recordings]
    admin_surface = payload.surface == "admin" or bool(payload.sessionId)
    session_id = (payload.sessionId[:80] or f"qa-{uuid.uuid4()}") if admin_surface else ""
    existing_session = await connection.fetchrow("SELECT title, title_source FROM admin_qa_sessions WHERE id = $1", session_id) if session_id else None
    should_generate_title = admin_surface and (not existing_session or existing_session["title_source"] == "system")
    if should_generate_title:
        title, title_source = title_from_intent(llm_answer.intent, question)
        if title_source != "llm":
            title, title_source = await generate_session_title(question, llm_answer.answer)
    else:
        title, title_source = (existing_session["title"], existing_session["title_source"]) if existing_session else ("", "system")
    message_id = str(uuid.uuid4())
    async with connection.transaction():
        session_row = None
        if admin_surface:
            await connection.execute(
                """
                INSERT INTO admin_qa_sessions (
                  id, user_id, surface, title, title_source, preview, status, recording_ids,
                  scope_json, model, prompt_version
                )
                VALUES ($1, 'default-user', 'admin', $2, $3, $4, 'active', $5, $6, $7, $8)
                ON DUPLICATE KEY UPDATE
                  title = CASE WHEN title_source = 'manual' THEN title ELSE VALUES(title) END,
                  title_source = CASE WHEN title_source = 'manual' THEN title_source ELSE VALUES(title_source) END,
                  preview = VALUES(preview),
                  status = 'active',
                  recording_ids = VALUES(recording_ids),
                  scope_json = VALUES(scope_json),
                  model = VALUES(model),
                  prompt_version = VALUES(prompt_version),
                  archived_at = NULL,
                  deleted_at = NULL,
                  updated_at = now()
                """,
                session_id,
                title,
                title_source,
                question[:160],
                recording_ids,
                {"key": scope, "label": label, "intent": llm_answer.intent},
                llm_answer.model,
                PROMPT_VERSION,
            )
            session_row = await connection.fetchrow("SELECT * FROM admin_qa_sessions WHERE id = $1", session_id)
        await connection.execute(
            """
            INSERT INTO admin_qa_messages (
              id, recording_id, recording_ids, user_id, surface, session_id, question, answer,
              jump_to_ms, citations, attachments, warning_text, empty_reason, scope_key,
              scope_label, scope_terms, context_recording_ids
            )
            VALUES ($1, $2, $3, 'default-user', $4, $5, $6, $7, $8, $9, $10, $11, '', $12, $13, $14, $15)
            """,
            message_id,
            recording_ids[0] if len(recording_ids) == 1 else None,
            recording_ids,
            payload.surface if payload.surface in {"admin", "mobile"} else ("admin" if payload.sessionId else "mobile"),
            session_id,
            question,
            llm_answer.answer,
            llm_answer.citations[0]["startMs"] if llm_answer.citations else 0,
            llm_answer.citations,
            payload.attachments[:6],
            warning,
            scope,
            label,
            [llm_answer.intent],
            llm_answer.context_recording_ids,
        )
        row = await connection.fetchrow("SELECT * FROM admin_qa_messages WHERE id = $1", message_id)
    names = await fetch_recording_names(connection, recording_ids)
    response = {"message": public_qa_message(row_dict(row), names)}
    if session_row:
        response["session"] = public_qa_session(row_dict(session_row))
    return response


if settings.dist_dir.exists():
    assets_dir = settings.dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def frontend(full_path: str) -> FileResponse:
        if full_path.startswith(("api/", "admin-api/")):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        target = settings.dist_dir / full_path
        if full_path and target.is_file():
            return FileResponse(target)
        index_file = settings.dist_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="前端构建产物不存在，请先运行 npm run build")
