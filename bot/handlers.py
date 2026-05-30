# bot/handlers.py

import logging
import asyncio
import io
import mimetypes
from telegram import Update
from telegram.ext import ContextTypes
from google.genai import errors as genai_errors

from bot import helpers
from services.adk_service import ADKService
from services.dialogue_logging import append_dialogue_turn, log_adk_turn
try:
    from chat_dataset_logger import save_message
except ImportError:
    # Модуль chat_dataset_logger не ўсталяваны — выкарыстоўваем заглушку
    def save_message(**kwargs):  # noqa: E302
        pass
import config

log = logging.getLogger(__name__)

# --- ВЫПРАЎЛЕННЕ: Гнуткая логіка валідацыі ---
# Спіс дазволеных прэфіксаў для медыяфайлаў
SUPPORTED_MIME_PREFIXES = ("image/", "audio/", "video/", "text/")
# Спіс дазволеных дакладных тыпаў для дакументаў
SUPPORTED_EXACT_MIME_TYPES = (
    "application/pdf",
    "application/json",
    "application/xml",
    "application/rtf",
    "application/x-javascript",
    "application/x-python",
    "application/x-python-code",
)

def is_mime_type_supported(mime_type: str | None) -> bool:
    """
    Правярае, ці падтрымліваецца MIME-тып для адпраўкі ў Gemini.
    Спачатку правярае дакладныя тыпы, потым - прэфіксы.
    """
    if not mime_type:
        return False
    # 1. Правяраем дакладнае супадзенне для дакументаў
    if mime_type in SUPPORTED_EXACT_MIME_TYPES:
        return True
    # 2. Правяраем супадзенне прэфікса для ўсіх медыяфайлаў
    if mime_type.startswith(SUPPORTED_MIME_PREFIXES):
        return True
    # Калі нічога не супала, тып не падтрымліваецца
    return False


def get_context_adk_service(context: ContextTypes.DEFAULT_TYPE) -> ADKService:
    adk_service = getattr(context.application, "adk_service", None)
    if adk_service is not None:
        return adk_service
    try:
        return context.application.bot_data["adk_service"]
    except KeyError as exc:
        raise RuntimeError("ADK service is not configured for Telegram application") from exc


def _telegram_dialogue_user_label(user) -> str:
    username = getattr(user, "username", None)
    if isinstance(username, str) and username.strip():
        return f"@{username.strip()}"
    return str(getattr(user, "id", "unknown"))


async def _append_telegram_dialogue_turn(update: Update, user_text: str | None, assistant_text: str | None) -> None:
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
    """Handles the /start command."""
    await helpers._safe_call(
        context.bot.send_message(update.effective_chat.id, "Вітаю! Я гатовы."),
        action="send_message:start"
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receives a message and creates a background task to process it."""
    context.application.create_task(
        _process_message_task(update, context),
        update=update
    )

async def _process_message_task(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    The core logic for processing a user's message with flexible file type pre-validation.
    """
    chat_id = update.effective_chat.id
    user_id = str(update.effective_user.id)
    message = update.message

    user_text = message.text or message.caption or ""
    file_data, mime_type, file_name = None, None, None
    file_to_download = None

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
    elif message.sticker:
        sticker = message.sticker
        if not sticker.is_animated and not sticker.is_video:
            file_to_download = sticker
            mime_type = "image/webp"

    if not user_text and not file_to_download:
        return

    adk_service = get_context_adk_service(context)

    try:
        session_id = await adk_service.get_or_create_session(user_id)
        log.info(f"Processing message for user {user_id} in session {session_id}")

        if file_to_download:
            log.info(f"Downloading file: {file_to_download.file_id}")
            tg_file = await context.bot.get_file(file_to_download.file_id)
            file_stream = io.BytesIO()
            await tg_file.download_to_memory(file_stream)
            file_data = file_stream.getvalue()
            if not file_name:
                ext = mimetypes.guess_extension(mime_type) or '.dat'
                file_name = f"{file_to_download.file_unique_id}{ext}"
            if not mime_type and file_name:
                 mime_type, _ = mimetypes.guess_type(file_name)
            log.info(f"File downloaded: {len(file_data)} bytes, mime: {mime_type}, name: {file_name}")

        user_audio_bytes, user_image_bytes = None, None
        if file_data and mime_type:
            if mime_type.startswith("image/"):
                user_image_bytes = file_data
            else:
                user_audio_bytes = file_data
        save_message(
            session_id=session_id,
            speaker=f"{update.effective_user.first_name} @{update.effective_user.username}",
            text=user_text,
            audio_bytes=user_audio_bytes,
            image_bytes=user_image_bytes,
        )

        await helpers._safe_call(context.bot.send_chat_action(chat_id, "typing"), action="chat_action:typing")

        reply_text, delta, parts = "", {}, []
        
        # Правяраем, ці падтрымліваецца файл, выкарыстоўваючы новую функцыю
        if file_data and not is_mime_type_supported(mime_type):
            log.warning(f"Unsupported MIME type '{mime_type}'. Skipping agent call.")
            reply_text = f"На жаль, я не магу апрацаваць файлы тыпу `{mime_type}`. Калі ласка, дашліце файл у адным з падтрымоўваных фарматаў (PDF, TXT, аўдыё, відэа ці выявы)."
        else:
            try:
                reply_text, delta, parts = await asyncio.wait_for(
                    asyncio.to_thread(
                        adk_service.run_agent, 
                        session_id, user_id, 
                        text=user_text, file_data=file_data, mime_type=mime_type
                    ),
                    timeout=config.AGENT_TIMEOUT,
                )
            except asyncio.TimeoutError:
                log.warning(f"Agent timed out for user {user_id}")
                await helpers._safe_call(context.bot.send_message(chat_id, config.DEFAULT_NO_ANSWER), action="send_message:timeout")
                log_adk_turn(log, user_text=user_text, assistant_text=config.DEFAULT_NO_ANSWER)
                await _append_telegram_dialogue_turn(update, user_text, config.DEFAULT_NO_ANSWER)
                save_message(session_id=session_id, speaker="Агент", text=config.DEFAULT_NO_ANSWER)
                return
            except genai_errors.ClientError as e:
                log.error(f"Handler caught a ClientError despite pre-validation: {e}")
                reply_text = config.DEFAULT_ERROR

        responded_with_media = False
        agent_audio_bytes, agent_image_bytes = None, None
        sent_media_from_parts, agent_audio_bytes, agent_image_bytes = await adk_service.send_media_from_parts(chat_id, context, parts)
        responded_with_media |= sent_media_from_parts
        if not responded_with_media:
            sent_media_from_artifacts, a2, i2 = await adk_service.send_media_from_artifacts(chat_id, context, user_id, session_id, delta)
            responded_with_media |= sent_media_from_artifacts
            agent_audio_bytes = agent_audio_bytes or a2
            agent_image_bytes = agent_image_bytes or i2
        
        clean_reply = reply_text.strip()
        if clean_reply:
            await helpers._safe_call(context.bot.send_message(chat_id, clean_reply), action="send_message:reply")
        elif not responded_with_media:
            await helpers._safe_call(context.bot.send_message(chat_id, config.DEFAULT_NO_ANSWER), action="send_message:no_answer")

        assistant_log_text = clean_reply or (config.DEFAULT_NO_ANSWER if not responded_with_media else None)
        log_adk_turn(log, user_text=user_text, assistant_text=assistant_log_text)
        await _append_telegram_dialogue_turn(update, user_text, assistant_log_text)

        save_message(
            session_id=session_id,
            speaker="Агент",
            text=reply_text,
            audio_bytes=agent_audio_bytes,
            image_bytes=agent_image_bytes,
        )

    except Exception as exc:
        log.exception(f"Unhandled error in message processing task for user {user_id}: {exc}")
        log_adk_turn(log, user_text=user_text, assistant_text=config.DEFAULT_ERROR)
        await _append_telegram_dialogue_turn(update, user_text, config.DEFAULT_ERROR)
        await helpers._safe_call(context.bot.send_message(chat_id, config.DEFAULT_ERROR), action="send_message:error")
