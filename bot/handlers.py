from __future__ import annotations

import asyncio
import io
import logging
import mimetypes

from telegram import Update
from telegram.ext import ContextTypes

import config
from bot import helpers
from services.adk_service import ADKService
from services.chat_service import ChatFile, ChatMedia, ChatRequest, ChatService
from services.dialogue_logging import append_dialogue_turn, log_adk_turn
from services.gemini_file_policy import validate_gemini_chat_file

try:
    from chat_dataset_logger import save_message
except ImportError:
    def save_message(**kwargs):  # noqa: E302
        _ = kwargs


log = logging.getLogger(__name__)

def is_mime_type_supported(mime_type: str | None) -> bool:
    return validate_gemini_chat_file(
        mime_type=mime_type,
        size_bytes=0,
    ).supported


def get_context_adk_service(context: ContextTypes.DEFAULT_TYPE) -> ADKService:
    adk_service = getattr(context.application, "adk_service", None)
    if adk_service is not None:
        return adk_service
    try:
        return context.application.bot_data["adk_service"]
    except KeyError as exc:
        raise RuntimeError("ADK service is not configured for Telegram application") from exc


def get_context_chat_service(context: ContextTypes.DEFAULT_TYPE) -> ChatService:
    chat_service = getattr(context.application, "chat_service", None)
    if chat_service is not None:
        return chat_service

    chat_service = context.application.bot_data.get("chat_service")
    if chat_service is not None:
        return chat_service

    from api.deps import (
        adk_session_store,
        artifact_store,
        chat_message_store,
        conversation_store,
    )

    return ChatService(
        adk_service=get_context_adk_service(context),
        conversation_store=conversation_store,
        chat_message_store=chat_message_store,
        artifact_store=artifact_store,
        adk_session_store=adk_session_store,
    )


async def _send_media_from_chat_result(
    chat_id: int,
    context: ContextTypes.DEFAULT_TYPE,
    artifacts: list[ChatMedia],
) -> tuple[bool, bytes | None, bytes | None]:
    wavs = [item.data for item in artifacts if item.kind == "audio"]
    imgs = [item.data for item in artifacts if item.kind == "image"]
    docs = [
        (item.data, item.filename)
        for item in artifacts
        if item.kind not in {"audio", "image"}
    ]

    sent = False
    if wavs:
        sent |= await helpers.send_wavs(chat_id, context, wavs)
    if imgs:
        sent |= await helpers.send_images(chat_id, context, imgs)
    if docs:
        sent |= await helpers.send_documents(chat_id, context, docs)

    return sent, (wavs[0] if wavs else None), (imgs[0] if imgs else None)


def _telegram_dialogue_user_label(user) -> str:
    username = getattr(user, "username", None)
    if isinstance(username, str) and username.strip():
        return f"@{username.strip()}"
    return str(getattr(user, "id", "unknown"))


async def _append_telegram_dialogue_turn(
    update: Update,
    user_text: str | None,
    assistant_text: str | None,
) -> None:
    await asyncio.to_thread(
        append_dialogue_turn,
        config.CHAT_DIALOGUE_LOG_PATH,
        user_id=str(update.effective_user.id),
        user_label=_telegram_dialogue_user_label(update.effective_user),
        user_text=user_text,
        assistant_text=assistant_text,
        logger=log,
    )


async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await helpers._safe_call(
        context.bot.send_message(update.effective_chat.id, "Вітаю! Я гатовы."),
        action="send_message:start",
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.application.create_task(
        _process_message_task(update, context),
        update=update,
    )


def _message_file(message):
    file_to_download = None
    mime_type = None
    file_name = None

    if message.document:
        file_to_download = message.document
        mime_type = file_to_download.mime_type
        file_name = file_to_download.file_name
    elif message.photo:
        file_to_download = message.photo[-1]
        mime_type = "image/jpeg"
    elif message.audio:
        file_to_download = message.audio
        mime_type = file_to_download.mime_type
        file_name = file_to_download.file_name
    elif message.voice:
        file_to_download = message.voice
        mime_type = file_to_download.mime_type or "audio/ogg"
    elif message.video:
        file_to_download = message.video
        mime_type = file_to_download.mime_type
        file_name = file_to_download.file_name
    elif message.video_note:
        file_to_download = message.video_note
        mime_type = "video/mp4"
    elif message.animation:
        file_to_download = message.animation
        mime_type = file_to_download.mime_type or "video/mp4"
        file_name = file_to_download.file_name
    elif message.sticker and not message.sticker.is_animated and not message.sticker.is_video:
        file_to_download = message.sticker
        mime_type = "image/webp"

    return file_to_download, mime_type, file_name


async def _process_message_task(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user_id = str(update.effective_user.id)
    message = update.message

    user_text = message.text or message.caption or ""
    file_to_download, mime_type, file_name = _message_file(message)

    if not user_text and not file_to_download:
        return

    chat_service = get_context_chat_service(context)
    file_data = None

    try:
        if file_to_download:
            log.info("Downloading Telegram file: %s", file_to_download.file_id)
            tg_file = await context.bot.get_file(file_to_download.file_id)
            file_stream = io.BytesIO()
            await tg_file.download_to_memory(file_stream)
            file_data = file_stream.getvalue()
            if not file_name:
                ext = mimetypes.guess_extension(mime_type) if mime_type else None
                file_name = f"{file_to_download.file_unique_id}{ext or '.dat'}"
            if not mime_type and file_name:
                mime_type, _ = mimetypes.guess_type(file_name)
            log.info(
                "Telegram file downloaded: %s bytes, mime=%s, name=%s",
                len(file_data),
                mime_type,
                file_name,
            )

        await helpers._safe_call(
            context.bot.send_chat_action(chat_id, "typing"),
            action="chat_action:typing",
        )

        file_policy = validate_gemini_chat_file(
            mime_type=mime_type,
            size_bytes=len(file_data) if file_data else 0,
        )
        if file_data and not file_policy.supported:
            reply_text = file_policy.message
            await helpers._safe_call(
                context.bot.send_message(chat_id, reply_text),
                action="send_message:unsupported",
            )
            log_adk_turn(log, user_text=user_text, assistant_text=reply_text)
            await _append_telegram_dialogue_turn(update, user_text, reply_text)
            return

        chat_files: list[ChatFile] = []
        if file_data and mime_type:
            chat_files.append(
                ChatFile(
                    filename=file_name or "telegram-upload.bin",
                    mime_type=mime_type,
                    data=file_data,
                    metadata={
                        "telegram_file_id": getattr(file_to_download, "file_id", None),
                    },
                )
            )

        result = await chat_service.process(
            ChatRequest(
                user_id=user_id,
                channel="telegram",
                text=user_text,
                files=chat_files,
                metadata={
                    "dialogue_log_path": config.CHAT_DIALOGUE_LOG_PATH,
                    "telegram_chat_id": chat_id,
                    "user_label": _telegram_dialogue_user_label(update.effective_user),
                },
                timeout_seconds=config.AGENT_TIMEOUT,
                timeout_reply=config.DEFAULT_NO_ANSWER,
                error_reply=config.DEFAULT_ERROR,
                no_answer_reply=config.DEFAULT_NO_ANSWER,
            )
        )
        log.info("Processed Telegram message for user %s in session %s", user_id, result.session_id)

        user_audio_bytes, user_image_bytes = None, None
        if file_data and mime_type:
            if mime_type.startswith("image/"):
                user_image_bytes = file_data
            else:
                user_audio_bytes = file_data
        save_message(
            session_id=result.session_id,
            speaker=f"{update.effective_user.first_name} @{update.effective_user.username}",
            text=user_text,
            audio_bytes=user_audio_bytes,
            image_bytes=user_image_bytes,
        )

        responded_with_media, agent_audio_bytes, agent_image_bytes = (
            await _send_media_from_chat_result(chat_id, context, result.artifacts)
        )

        clean_reply = (result.text or "").strip()
        if clean_reply:
            await helpers._safe_call(
                context.bot.send_message(chat_id, clean_reply),
                action="send_message:reply",
            )
        elif not responded_with_media:
            await helpers._safe_call(
                context.bot.send_message(chat_id, config.DEFAULT_NO_ANSWER),
                action="send_message:no_answer",
            )

        assistant_log_text = clean_reply or (
            config.DEFAULT_NO_ANSWER if not responded_with_media else None
        )
        save_message(
            session_id=result.session_id,
            speaker="Агент",
            text=assistant_log_text,
            audio_bytes=agent_audio_bytes,
            image_bytes=agent_image_bytes,
        )

    except Exception as exc:
        log.exception("Unhandled error in Telegram message processing for user %s: %s", user_id, exc)
        log_adk_turn(log, user_text=user_text, assistant_text=config.DEFAULT_ERROR)
        await _append_telegram_dialogue_turn(update, user_text, config.DEFAULT_ERROR)
        await helpers._safe_call(
            context.bot.send_message(chat_id, config.DEFAULT_ERROR),
            action="send_message:error",
        )
