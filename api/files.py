# api/files.py
"""
Endpoint для аддачы файлаў (аўдыя, малюнкі і г.д.).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response

from api.auth import AuthenticatedUser, get_current_user
from api.deps import artifact_store

log = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/files/{artifact_id}")
async def get_file(
    artifact_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    artifact = artifact_store.get_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="File not found")
    if artifact["user_id"] != current_user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    _, data = artifact_store.get_download_bytes(artifact_id)
    return Response(
        content=data,
        media_type=artifact["mime_type"],
        headers={
            "Content-Disposition": f'inline; filename="{artifact["filename"]}"',
        },
    )
