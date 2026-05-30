from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, Depends, File, Form, UploadFile

import config
from api.auth import AuthenticatedUser, get_current_user
from api.deps import (
    adk_service,
    artifact_store,
    chat_histories,
    chat_message_store,
    collect_artifacts,
    conversation_store,
    guess_mime,
)
from services.dialogue_logging import append_dialogue_turn, log_adk_turn

log = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["chat"])


def _append_history_message(user_id: str, conversation_id: str, role: str, content: str) -> None:
    chat_message_store.append_message(conversation_id, user_id, role, content)


def _append_turn(user_id: str, conversation_id: str, user_text: str, assistant_text: str | None) -> None:
    if user_text:
        _append_history_message(user_id, conversation_id, "user", user_text)
    if assistant_text:
        _append_history_message(user_id, conversation_id, "assistant", assistant_text)


def _authenticated_user_log_label(current_user: AuthenticatedUser) -> str | None:
    email = current_user.claims.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip()
    return None


@router.post("/chat")
async def api_chat(
    text: str = Form(""),
    user_id: str | None = Form(default=None),
    files: List[UploadFile] = File(default=[]),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    _ = user_id
    resolved_user_id = current_user.user_id
    original_text = text
    conversation = conversation_store.get_or_create_active_conversation(resolved_user_id)
    conversation_id = conversation["id"]
    session_id = await adk_service.get_or_create_session(
        resolved_user_id,
        conversation_id=conversation_id,
    )

    response: Dict = {"text": None, "audio": None, "image": None}

    for uploaded_file in files:
        try:
            file_bytes = await uploaded_file.read()
            mime = uploaded_file.content_type or guess_mime(Path(uploaded_file.filename))

            artifact_store.store_user_upload(
                user_id=resolved_user_id,
                conversation_id=conversation_id,
                filename=uploaded_file.filename or "upload.bin",
                mime_type=mime,
                data=file_bytes,
                metadata={"source": "chat_upload"},
            )

            text_reply, delta, parts = await asyncio.to_thread(
                adk_service.run_agent,
                session_id=session_id,
                user_id=resolved_user_id,
                text=text if text else None,
                file_data=file_bytes,
                mime_type=mime,
            )

            if text_reply:
                response["text"] = text_reply

            await collect_artifacts(
                adk_service,
                resolved_user_id,
                session_id,
                conversation_id,
                delta,
                response,
            )
            text = ""
        except Exception as exc:
            log.exception("Error processing file: %s", exc)

    if text and not files:
        try:
            text_reply, delta, parts = await asyncio.to_thread(
                adk_service.run_agent,
                session_id=session_id,
                user_id=resolved_user_id,
                text=text,
                file_data=None,
                mime_type=None,
            )

            if text_reply:
                response["text"] = text_reply

            await collect_artifacts(
                adk_service,
                resolved_user_id,
                session_id,
                conversation_id,
                delta,
                response,
            )
        except Exception as exc:
            log.exception("Error running agent: %s", exc)
            response["text"] = "Прабачце, адбылася памылка. Паспрабуйце яшчэ раз."

    if original_text or files:
        history_text = original_text or ", ".join(file.filename for file in files)
        _append_turn(resolved_user_id, conversation_id, history_text, response["text"])
        conversation_store.touch(conversation_id)
        log_adk_turn(
            log,
            user_text=original_text,
            assistant_text=response["text"],
        )
        await asyncio.to_thread(
            append_dialogue_turn,
            config.CHAT_DIALOGUE_LOG_PATH,
            user_id=resolved_user_id,
            user_label=_authenticated_user_log_label(current_user),
            user_text=history_text,
            assistant_text=response["text"],
            logger=log,
        )

    return response


@router.get("/chat/history")
async def get_chat_history(
    user_id: str | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    _ = user_id
    conversation = conversation_store.get_active_conversation(current_user.user_id)
    if conversation:
        return {"history": chat_message_store.list_messages(conversation["id"])}
    return {"history": []}


@router.delete("/chat/history")
async def clear_chat_history(
    user_id: str | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    _ = user_id
    conversation_store.clear_active_conversation(current_user.user_id)
    chat_histories[current_user.user_id] = []
    return {"status": "ok"}
