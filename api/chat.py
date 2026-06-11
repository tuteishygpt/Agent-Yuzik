from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, Depends, File, Form, UploadFile

import config
from api.auth import AuthenticatedUser, get_current_user
from api.deps import (
    adk_service,
    adk_session_store,
    artifact_store,
    chat_histories,
    chat_message_store,
    conversation_store,
    guess_mime,
)
from services.chat_service import ChatFile, ChatRequest, ChatService

log = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["chat"])


def _authenticated_user_log_label(current_user: AuthenticatedUser) -> str | None:
    email = current_user.claims.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip()
    return None


def _chat_service() -> ChatService:
    return ChatService(
        adk_service=adk_service,
        conversation_store=conversation_store,
        chat_message_store=chat_message_store,
        artifact_store=artifact_store,
        adk_session_store=adk_session_store,
    )


@router.post("/chat")
async def api_chat(
    text: str = Form(""),
    user_id: str | None = Form(default=None),
    files: List[UploadFile] = File(default=[]),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    _ = user_id
    resolved_user_id = current_user.user_id

    chat_files: list[ChatFile] = []
    for uploaded_file in files:
        filename = uploaded_file.filename or "upload.bin"
        file_bytes = await uploaded_file.read()
        chat_files.append(
            ChatFile(
                filename=filename,
                mime_type=uploaded_file.content_type or guess_mime(Path(filename)),
                data=file_bytes,
                metadata={"source": "chat_upload"},
            )
        )

    result = await _chat_service().process(
        ChatRequest(
            user_id=resolved_user_id,
            channel="web",
            text=text,
            files=chat_files,
            metadata={
                "dialogue_log_path": config.CHAT_DIALOGUE_LOG_PATH,
                "user_label": _authenticated_user_log_label(current_user),
            },
            error_reply=config.DEFAULT_ERROR,
            no_answer_reply=config.DEFAULT_NO_ANSWER,
        )
    )

    response: Dict = {
        "text": result.text,
        "audio": result.audio,
        "image": result.image,
        "artifacts": [
            {
                "kind": artifact.kind,
                "filename": artifact.filename,
                "mime_type": artifact.mime_type,
                "url": artifact.url,
            }
            for artifact in result.artifacts
            if artifact.url
        ],
    }
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
