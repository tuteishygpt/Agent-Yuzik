import logging
from typing import List
from telegram import InputMediaPhoto
from telegram.error import TelegramError
from telegram.ext import ContextTypes

log = logging.getLogger(__name__)

async def _safe_call(coro, *, action: str) -> bool:
    """Safely executes a coroutine, logging any Telegram or other errors."""
    try:
        await coro
        return True
    except TelegramError as err:
        log.error(f"Telegram {action} error: {err}")
    except Exception as exc:
        log.exception(f"Unexpected error during Telegram {action}: {exc}")
    return False

async def send_wavs(chat_id: int, context: ContextTypes.DEFAULT_TYPE, wavs: List[bytes]) -> bool:
    """Sends a list of WAV audio bytes as documents."""
    ok_all = True
    if not wavs:
        return False
    for idx, data in enumerate(wavs, 1):
        await _safe_call(
            context.bot.send_chat_action(chat_id, "upload_document"),
            action="chat_action:upload_document",
        )
        ok_all &= await _safe_call(
            context.bot.send_document(chat_id, data, filename=f"voice_{idx}.wav"),
            action="send_document",
        )
    return ok_all

async def send_images(
    chat_id: int,
    context: ContextTypes.DEFAULT_TYPE,
    images: List[bytes],
    caption: str | None = None,
) -> bool:
    """Sends one or more images."""
    if not images:
        return False
    await _safe_call(context.bot.send_chat_action(chat_id, "upload_photo"), action="chat_action:upload_photo")
    if len(images) == 1:
        return await _safe_call(
            context.bot.send_photo(chat_id, images[0], caption=caption),
            action="send_photo",
        )
    media = [InputMediaPhoto(b) for b in images[:10]] # Telegram limit
    if caption:
        media[0].caption = caption
    return await _safe_call(
        context.bot.send_media_group(chat_id, media),
        action="send_media_group",
    )