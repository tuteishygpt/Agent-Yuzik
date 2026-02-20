# tools/text_to_speech_tool.py
"""
Інструмент для сінтэзу маўлення (Belarusian TTS).
Выкарыстоўвае лакальны сэрвіс `local_xtts_service` і вяртае WAV-файл
у выглядзе артэфакта ADK або стрыміць аўдыя, калі ўключаны voice mode.
"""

from __future__ import annotations

import os
import traceback
from typing import Optional, AsyncGenerator, Dict, Tuple
import asyncio
import logging

from google.genai import types
from google.adk.tools import FunctionTool, ToolContext

from services.local_xtts_service import stream_audio, synthesize_to_file

log = logging.getLogger(__name__)

# ────────────────────────── global queues for voice streaming ─────────────
voice_queues: Dict[str, Tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = {}

def register_voice_user(user_id: str, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
    voice_queues[user_id] = (queue, loop)
    log.info(f"Registered voice queue for user {user_id}")

def unregister_voice_user(user_id: str):
    if user_id in voice_queues:
        del voice_queues[user_id]
        log.info(f"Unregistered voice queue for user {user_id}")

async def stream_speech(text: str, speaker_audio_path: Optional[str] = None) -> AsyncGenerator[bytes, None]:
    """
    Стрымінг аўдыя праз лакальны XTTS.
    Вяртае генератар, які yield-зіць байты аўдыя (WAV chunk або PCM).
    """
    try:
        # yield_raw_pcm = False азначае, што дадаецца WAV-загаловак да кожнага чанка 
        # (гэта дазваляе звычайным плэерам прайграваць кожны чанк незалежна)
        async for chunk in stream_audio(text, speaker_audio_path, yield_raw_pcm=False):
            yield chunk
    except Exception as e:
        log.error(f"Error in local stream_speech: {e}")
        traceback.print_exc()

# ────────────────────────── асноўная функцыя ─────────────────────────────
async def synthesize_speech(
    text: str,
    speaker_audio_path: Optional[str] = None,
    tool_context: Optional[ToolContext] = None,
) -> types.Part:
    """
    Канвертуе тэкст у WAV-аўдыя.

    Parameters
    ----------
    text : str
        Тэкст, які трэба агучыць.
    speaker_audio_path : str | None
        Шлях да файла з прыкладам голасу (неабавязкова).
    tool_context : ToolContext
        Ін'ектуецца ADK; утрымлівае save_artifact / load_artifact.

    Returns
    -------
    types.Part
        Part, які ўтрымлівае толькі метаданыя артэфакта (без байтаў).
    """
    result_path: Optional[str] = None

    try:
        # Check if streaming is enabled for this user
        user_id = tool_context.user_id if tool_context else None
        if user_id and user_id in voice_queues:
            log.info(f"Streaming TTS for user {user_id}")
            queue, loop = voice_queues[user_id]
            
            # Stream directly to queue (thread-safe)
            async for chunk in stream_speech(text, speaker_audio_path):
                loop.call_soon_threadsafe(queue.put_nowait, chunk)
            
            return types.Part(text="[Audio streamed directly]")

        # --- Standard Mode (Не стрымінг) ---
        import tempfile
        # Ствараем часовы файл для захавання
        fd, result_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd) # закрываем descriptors
        
        # Сінтэз поўнага выніку і захаванне
        result_path = synthesize_to_file(text, result_path, speaker_audio_path)

        # --- чытаем WAV ---
        with open(result_path, "rb") as f:
            audio_bytes = f.read()

        # --- ствараем Part і захоўваем як артэфакт ---
        audio_part = types.Part.from_bytes(data=audio_bytes, mime_type="audio/wav")
        artifact_part = await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio_part,
        )

        return artifact_part  # вяртаем Part з artifact (без inline_data)

    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        # вяртаем тэкставую памылку, каб агент мог апрацаваць
        return types.Part(text=f"Памылка пры лакальным сінтэзе маўлення: {exc!r}")

    finally:
        # --- ачышчаем часовы файл ---
        if result_path and os.path.exists(result_path):
            try:
                os.remove(result_path)
            except OSError as exc:
                log.error(f"Не атрымалася выдаліць {result_path}: {exc}")


# ────────────────────────── рэгістрацыя ў ADK ────────────────────────────
synthesize_speech_tool = FunctionTool(func=synthesize_speech)
