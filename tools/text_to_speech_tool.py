# tools/text_to_speech_tool.py
"""
Інструмент для сінтэзу маўлення (Belarusian TTS).

Падтрымлівае два рэжымы (задаецца праз TTS_MODE у .env):
  • "local" — лакальны XTTS (патрэбны GPU + coqui-ai-TTS)
  • "api"   — Gradio API (HuggingFace Spaces, без цяжкіх залежнасцей)

Калі TTS_MODE=api, праект запускаецца без torch / coqui-ai-TTS.
"""


import os
import traceback
from typing import Optional, AsyncGenerator, Dict, Any, Tuple
import asyncio
import logging

from google.genai import types
from google.adk.tools import FunctionTool, ToolContext

import config  # TTS_MODE, HF_TOKEN

log = logging.getLogger(__name__)

TTS_MODE = config.TTS_MODE  # "local" | "api"
log.info(f"TTS mode: {TTS_MODE}")

# ═══════════════════════════════════════════════════════════════════════
# Ініцыялізацыя бэкенда ў залежнасці ад рэжыму
# ═══════════════════════════════════════════════════════════════════════

if TTS_MODE == "api":
    # ── API mode: выкарыстоўваем gradio_client ──────────────────────
    import base64
    import re
    import struct

    from gradio_client import Client, handle_file

    HUGGINGFACE_API_TOKEN = config.HF_TOKEN or os.getenv("HF_TOKEN")
    voice_client = None

    if HUGGINGFACE_API_TOKEN:
        gradio_client = Client(
            "archivartaunik/Bextts", token=HUGGINGFACE_API_TOKEN
        )
        try:
            voice_client = Client(
                "archivartaunik/BexttsAssist", token=HUGGINGFACE_API_TOKEN
            )
            log.info("BexttsAssist client initialized successfully.")
        except Exception as e:
            log.warning(f"Failed to initialize BexttsAssist: {e}")
    else:
        log.warning(
            "HF_TOKEN не зададзены — выкарыстоўваю ананімны доступ."
        )
        gradio_client = Client("archivartaunik/BeTTSNaciski")
        try:
            voice_client = Client("archivartaunik/BexttsAssist")
            log.info("BexttsAssist client initialized (anon).")
        except Exception as e:
            log.warning(f"Failed to initialize BexttsAssist (anon): {e}")

else:
    # ── Local mode: выкарыстоўваем local_xtts_service ───────────────
    from services.local_xtts_service import stream_audio, synthesize_to_file


# ═══════════════════════════════════════════════════════════════════════
# Global queues for voice streaming (абодва рэжымы)
# ═══════════════════════════════════════════════════════════════════════

voice_queues: Dict[str, Tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = {}


def register_voice_user(
    user_id: str, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop
):
    voice_queues[user_id] = (queue, loop)
    log.info(f"Registered voice queue for user {user_id}")


def unregister_voice_user(user_id: str):
    if user_id in voice_queues:
        del voice_queues[user_id]
        log.info(f"Unregistered voice queue for user {user_id}")


# ═══════════════════════════════════════════════════════════════════════
# Утыліты для API-рэжыму
# ═══════════════════════════════════════════════════════════════════════

def _looks_like_base64(s: str) -> bool:
    """Эўрыстыка: ці падобны радок на base64."""
    if not isinstance(s, str):
        return False
    if s.startswith(("http://", "https://")):
        return False
    if s.startswith("data:"):
        return True
    if len(s) > 100 and not any(c.isspace() for c in s):
        return True
    return False


def _add_wav_header_api(
    pcm_data: bytes, sample_rate: int = 24000, channels: int = 1
) -> bytes:
    """Дадае WAV-загаловак да сырых Float32 PCM-даных."""
    import struct

    byte_count = len(pcm_data)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        byte_count + 36,
        b"WAVE",
        b"fmt ",
        16,  # Subchunk1Size
        3,  # AudioFormat: IEEE Float
        channels,
        sample_rate,
        sample_rate * channels * 4,  # ByteRate
        channels * 4,  # BlockAlign
        32,  # BitsPerSample
        b"data",
        byte_count,
    )
    return header + pcm_data


# ═══════════════════════════════════════════════════════════════════════
# stream_speech — стрымінг аўдыя (абодва рэжымы)
# ═══════════════════════════════════════════════════════════════════════

async def stream_speech(
    text: str, speaker_audio_path: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """
    Стрымінг аўдыя.
    • API mode  → BexttsAssist Gradio streaming
    • Local mode → local_xtts_service.stream_audio
    """
    if TTS_MODE == "api":
        async for chunk in _stream_speech_api(text, speaker_audio_path):
            yield chunk
    else:
        async for chunk in _stream_speech_local(text, speaker_audio_path):
            yield chunk


# ── API streaming ────────────────────────────────────────────────────

async def _stream_speech_api(
    text: str, speaker_audio_path: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """Стрымінг аўдыя праз BexttsAssist Gradio API."""
    if not voice_client:
        log.error(
            "Voice client (BexttsAssist) is not initialized. Cannot stream."
        )
        return

    import queue
    import threading

    loop = asyncio.get_running_loop()

    log.info(
        f"API Streaming TTS. Text length: {len(text)}. "
        f"First 100 chars: {text[:100]}"
    )

    chunk_queue: queue.Queue = queue.Queue()
    SENTINEL_DONE = object()

    def producer_thread():
        try:
            audio_input = (
                handle_file(speaker_audio_path) if speaker_audio_path else None
            )
            job = voice_client.submit(
                text_input=text,
                speaker_audio=audio_input,
                api_name="/text_to_speech",
            )
            for result in job:
                chunk_queue.put(result)
        except Exception as e:
            log.error(f"BexttsAssist prediction error: {e}")
            traceback.print_exc()
        finally:
            chunk_queue.put(SENTINEL_DONE)

    t = threading.Thread(target=producer_thread, daemon=True)
    t.start()

    def _process_item(item):
        """Апрацоўвае адзін элемент з вынікаў Gradio (шлях або base64)."""
        if isinstance(item, str):
            if os.path.exists(item):
                with open(item, "rb") as f:
                    content = f.read()
                try:
                    os.remove(item)
                except OSError:
                    pass
                return content
            elif _looks_like_base64(item):
                try:
                    raw = base64.b64decode(item)
                    if not raw.startswith(b"RIFF"):
                        raw = _add_wav_header_api(raw)
                    return raw
                except Exception:
                    pass
        return None

    while True:
        result = await loop.run_in_executor(None, chunk_queue.get)
        if result is SENTINEL_DONE:
            break

        items = result if isinstance(result, (list, tuple)) else [result]
        for item in items:
            audio_chunk = _process_item(item)
            if audio_chunk:
                log.info(f"Yielding API audio chunk ({len(audio_chunk)} bytes)")
                yield audio_chunk

    log.info("Finished API streaming TTS.")


# ── Local streaming ──────────────────────────────────────────────────

async def _stream_speech_local(
    text: str, speaker_audio_path: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """Стрымінг аўдыя праз лакальны XTTS."""
    try:
        async for chunk in stream_audio(
            text, speaker_audio_path, yield_raw_pcm=True
        ):
            yield chunk
    except Exception as e:
        log.error(f"Error in local stream_speech: {e}")
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════════════════
# stream_speech_multi — continuous multi-sentence TTS (no gaps)
# ═══════════════════════════════════════════════════════════════════════

async def stream_speech_multi(
    sentence_queue: asyncio.Queue,
    speaker_audio_path: Optional[str] = None,
) -> AsyncGenerator[bytes, None]:
    """
    Continuous TTS streaming from a queue of sentences.
    All sentences share ONE audio chunker — no gaps between sentences.

    For local mode: uses stream_audio_multi (single _chunker across sentences).
    For API mode: falls back to per-sentence streaming.

    Queue protocol: str items = text, None = stop sentinel.
    """
    if TTS_MODE == "local":
        from services.local_xtts_service import stream_audio_multi
        async for chunk in stream_audio_multi(
            sentence_queue, speaker_audio_path, yield_raw_pcm=True,
        ):
            yield chunk
    else:
        # API mode: per-sentence fallback (no local _chunker available)
        while True:
            sentence = await sentence_queue.get()
            if sentence is None:
                break
            sentence = sentence.strip()
            if not sentence:
                continue
            async for chunk in _stream_speech_api(sentence, speaker_audio_path):
                yield chunk


# ═══════════════════════════════════════════════════════════════════════
# synthesize_speech — асноўная функцыя (абодва рэжымы)
# ═══════════════════════════════════════════════════════════════════════

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
        # ── Streaming path (абодва рэжымы) ──
        user_id = tool_context._invocation_context.user_id if tool_context and hasattr(tool_context, "_invocation_context") else None
        if user_id and user_id in voice_queues:
            # Для API-рэжыму дадаткова правяраем voice_client
            if TTS_MODE == "api" and not voice_client:
                log.warning("API voice_client not available for streaming.")
            else:
                log.info(f"Streaming TTS for user {user_id}")
                queue_obj, loop = voice_queues[user_id]

                async for chunk in stream_speech(text, speaker_audio_path):
                    loop.call_soon_threadsafe(queue_obj.put_nowait, chunk)

                return types.Part(text="[Audio streamed directly]")

        # ── Standard (non-streaming) path ──
        if TTS_MODE == "api":
            result_path = await _synthesize_api(text, speaker_audio_path)
        else:
            result_path = await _synthesize_local(text, speaker_audio_path)

        if not result_path or not os.path.exists(result_path):
            raise ConnectionError("TTS did not produce a WAV file.")

        with open(result_path, "rb") as f:
            audio_bytes = f.read()

        audio_part = types.Part.from_bytes(
            data=audio_bytes, mime_type="audio/wav"
        )
        artifact_part = await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio_part,
        )

        return artifact_part

    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        return types.Part(
            text=f"Памылка пры сінтэзе маўлення ({TTS_MODE}): {exc!r}"
        )

    finally:
        if result_path and os.path.exists(result_path):
            try:
                os.remove(result_path)
            except OSError as exc:
                log.error(f"Не атрымалася выдаліць {result_path}: {exc}")


# ── API: non-streaming synthesis ─────────────────────────────────────

async def _synthesize_api(
    text: str, speaker_audio_path: Optional[str] = None
) -> Optional[str]:
    """Выклік Gradio TTS API і вяртанне шляху да WAV-файла."""
    loop = asyncio.get_running_loop()

    def _call():
        if speaker_audio_path:
            if not os.path.exists(speaker_audio_path):
                raise FileNotFoundError(
                    f"File for cloning not found: {speaker_audio_path}"
                )
            return gradio_client.predict(
                belarusian_story=text,
                speaker_audio_file=handle_file(speaker_audio_path),
                api_name="/predict",
            )
        else:
            return gradio_client.predict(
                belarusian_story=text,
                speaker_audio_file=None,
                api_name="/predict",
            )

    return await loop.run_in_executor(None, _call)


# ── Local: non-streaming synthesis ───────────────────────────────────

async def _synthesize_local(
    text: str, speaker_audio_path: Optional[str] = None
) -> Optional[str]:
    """Лакальны XTTS: сінтэз у файл."""
    import tempfile

    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, synthesize_to_file, text, tmp_path, speaker_audio_path
    )
    return result


# ═══════════════════════════════════════════════════════════════════════
# Рэгістрацыя ў ADK
# ═══════════════════════════════════════════════════════════════════════

synthesize_speech_tool = FunctionTool(func=synthesize_speech)
