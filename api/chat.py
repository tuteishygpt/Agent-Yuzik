# api/chat.py
"""
REST API endpoints для тэкставага чату.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, File, Form, UploadFile

from api.deps import (
    adk_service,
    append_to_history,
    chat_histories,
    collect_artifacts,
    guess_mime,
    FILES_DIR,
)

log = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["chat"])


# ---------------------------------------------------------------------
# POST /api/chat
# ---------------------------------------------------------------------

@router.post("/chat")
async def api_chat(
    text: str = Form(""),
    user_id: str = Form("default"),
    files: List[UploadFile] = File(default=[]),
):
    """Handle chat messages from the frontend."""
    session_id = await adk_service.get_or_create_session(user_id)

    if user_id not in chat_histories:
        chat_histories[user_id] = []

    response: Dict = {"text": None, "audio": None, "image": None}

    # Process files if any
    for uploaded_file in files:
        try:
            file_bytes = await uploaded_file.read()
            mime = uploaded_file.content_type or guess_mime(
                Path(uploaded_file.filename)
            )

            # Save file
            file_path = FILES_DIR / uploaded_file.filename
            with open(file_path, "wb") as f:
                f.write(file_bytes)

            text_reply, delta, parts = await asyncio.to_thread(
                adk_service.run_agent,
                session_id=session_id,
                user_id=user_id,
                text=text if text else None,
                file_data=file_bytes,
                mime_type=mime,
            )

            if text_reply:
                response["text"] = text_reply

            # Handle artifacts (audio/image) — выкарыстоўваем агульны хелпер
            await collect_artifacts(adk_service, user_id, session_id, delta, response)

            text = ""  # Clear text after first file

        except Exception as e:
            log.exception(f"Error processing file: {e}")

    # Process text-only message
    if text and not files:
        try:
            text_reply, delta, parts = await asyncio.to_thread(
                adk_service.run_agent,
                session_id=session_id,
                user_id=user_id,
                text=text,
                file_data=None,
                mime_type=None,
            )

            if text_reply:
                response["text"] = text_reply

            # Handle artifacts — выкарыстоўваем агульны хелпер
            await collect_artifacts(adk_service, user_id, session_id, delta, response)

        except Exception as e:
            log.exception(f"Error running agent: {e}")
            response["text"] = "Прабачце, адбылася памылка. Паспрабуйце яшчэ раз."

    # Store in history
    if text:
        append_to_history(user_id, {"role": "user", "content": text})
    if response["text"]:
        append_to_history(user_id, {"role": "assistant", "content": response["text"]})

    return response


# ---------------------------------------------------------------------
# GET /api/chat/history
# ---------------------------------------------------------------------

@router.get("/chat/history")
async def get_chat_history(user_id: str = "default"):
    """Get chat history for a user."""
    return {"history": chat_histories.get(user_id, [])}


# ---------------------------------------------------------------------
# DELETE /api/chat/history
# ---------------------------------------------------------------------

@router.delete("/chat/history")
async def clear_chat_history(user_id: str = "default"):
    """Clear chat history for a user."""
    if user_id in chat_histories:
        chat_histories[user_id] = []
    return {"status": "ok"}
