from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import HTTPException

from .config import settings


def _headers() -> dict[str, str]:
    if not settings.admin_backend_api_key:
        raise HTTPException(
            status_code=503,
            detail={"error": "中台数据网关密钥未配置", "code": "ADMIN_DATA_GATEWAY_NOT_CONFIGURED"},
        )
    return {"X-Admin-Api-Key": settings.admin_backend_api_key}


async def _get_json(path: str) -> dict[str, Any]:
    url = f"{settings.mobile_internal_api_url}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=_headers())
    except httpx.RequestError as error:
        raise HTTPException(status_code=502, detail=f"手机端数据服务连接失败：{error}") from error
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="录音不存在")
    if response.is_error:
        try:
            detail = response.json().get("error") or response.text
        except ValueError:
            detail = response.text
        raise HTTPException(status_code=502, detail=f"手机端数据服务返回错误：{detail}")
    return response.json()


async def list_recordings() -> list[dict[str, Any]]:
    return list((await _get_json("recordings")).get("recordings") or [])


async def get_recording(recording_id: str) -> dict[str, Any] | None:
    payload = await _get_json(f"recordings/{recording_id}")
    return payload.get("recording")


async def list_folders() -> dict[str, Any]:
    return await _get_json("folders")


async def get_profile() -> dict[str, Any]:
    return await _get_json("profile")


async def stream_recording_audio(recording_id: str) -> tuple[AsyncIterator[bytes], str, str]:
    url = f"{settings.mobile_internal_api_url}/recordings/{recording_id}/audio"
    client = httpx.AsyncClient(timeout=None)
    try:
        request = client.build_request("GET", url, headers=_headers())
        response = await client.send(request, stream=True)
    except Exception:
        await client.aclose()
        raise
    if response.is_error:
        await response.aclose()
        await client.aclose()
        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="音频文件不存在")
        raise HTTPException(status_code=502, detail="手机端音频服务返回错误")

    async def iterator() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return (
        iterator(),
        response.headers.get("content-type", "application/octet-stream"),
        response.headers.get("content-disposition", "inline"),
    )
