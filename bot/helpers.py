import asyncio
import io
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


def _wav_to_ogg_opus(wav_data: bytes) -> bytes | None:
    """Convert WAV bytes to OGG/Opus for Telegram voice messages."""
    try:
        from pydub import AudioSegment
    except ImportError:
        log.warning("pydub unavailable; cannot convert WAV → OGG/Opus")
        return None
    try:
        audio = AudioSegment.from_file(io.BytesIO(wav_data), format="wav")
        audio = audio.set_channels(1).set_frame_rate(48000)
        buf = io.BytesIO()
        audio.export(buf, format="ogg", codec="libopus", bitrate="48k")
        return buf.getvalue()
    except Exception as exc:
        log.warning(f"WAV → OGG/Opus conversion failed: {exc}")
        return None


async def send_wavs(chat_id: int, context: ContextTypes.DEFAULT_TYPE, wavs: List[bytes]) -> bool:
    """Send WAV audio as a Telegram voice message (OGG/Opus) with audio fallback."""
    ok_all = True
    if not wavs:
        return False
    for idx, data in enumerate(wavs, 1):
        ogg_data = await asyncio.to_thread(_wav_to_ogg_opus, data)
        if ogg_data:
            await _safe_call(
                context.bot.send_chat_action(chat_id, "record_voice"),
                action="chat_action:record_voice",
            )
            sent = await _safe_call(
                context.bot.send_voice(chat_id, ogg_data),
                action="send_voice",
            )
            if sent:
                continue
        # Fallback: send raw WAV as audio so users still get a player.
        await _safe_call(
            context.bot.send_chat_action(chat_id, "upload_voice"),
            action="chat_action:upload_voice",
        )
        ok_all &= await _safe_call(
            context.bot.send_audio(chat_id, data, filename=f"voice_{idx}.wav"),
            action="send_audio",
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