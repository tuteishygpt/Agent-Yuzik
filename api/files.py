# api/files.py
"""
Endpoint для аддачы файлаў (аўдыя, малюнкі і г.д.).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import FileResponse

from api.deps import FILES_DIR, guess_mime

log = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/files/{filename}")
async def get_file(filename: str):
    """Serve files (audio, images, etc.)."""
    file_path = FILES_DIR / filename
    if not file_path.exists():
        return {"error": "File not found"}, 404

    mime = guess_mime(file_path)
    return FileResponse(file_path, media_type=mime)
