# tools/text_to_speech_tool.py
"""
Інструмент для сінтэзу маўлення (Belarusian TTS).
Выкарыстоўвае Gradio-дэма «archivartaunik/Bextts» і вяртае WAV-файл
у выглядзе артэфакта ADK, каб асноўны Runner мог бяспечна пераслаць
файл карыстальніку без раздзьмухвання LLM-prompt.
"""

from __future__ import annotations

import os
import traceback
from typing import Optional, AsyncGenerator, Dict, Any, Tuple
import asyncio
import base64
import re

import logging
from google.genai import types
from google.adk.tools import FunctionTool, ToolContext
from gradio_client import Client, handle_file

log = logging.getLogger(__name__)

# ────────────────────────── ініцыялізацыя Gradio ─────────────────────────
HUGGINGFACE_API_TOKEN = os.getenv("HF_TOKEN")
voice_client = None

if HUGGINGFACE_API_TOKEN:
    gradio_client = Client("archivartaunik/Bextts", hf_token=HUGGINGFACE_API_TOKEN)
    # Кліент для стрымінгу (BexttsAssist)
    try:
        voice_client = Client("archivartaunik/BexttsAssist", hf_token=HUGGINGFACE_API_TOKEN)
        log.info("BexttsAssist client initialized successfully.")
    except Exception as e:
        log.warning(f"Failed to initialize BexttsAssist: {e}")
else:
    log.warning("HUGGINGFACE_TOKEN не зададзены — выкарыстоўваю ананімны доступ.")
    gradio_client = Client("archivartaunik/BeTTSNaciski")
    try:
        voice_client = Client("archivartaunik/BexttsAssist")
        log.info("BexttsAssist client initialized (anon).")
    except Exception as e:
        log.warning(f"Failed to initialize BexttsAssist (anon): {e}")


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
        # Check if streaming is enabled for this user AND voice client is ready
        user_id = tool_context.user_id if tool_context else None
        if user_id and user_id in voice_queues and voice_client:
            log.info(f"Streaming TTS for user {user_id}")
            queue, loop = voice_queues[user_id]
            
            # Stream directly to queue (thread-safe)
            async for chunk in stream_speech(text, speaker_audio_path):
                loop.call_soon_threadsafe(queue.put_nowait, chunk)
            
            # Signal end of stream if needed, or just let it be.
            # Frontend handles continuous stream.
            
            return types.Part(text="[Audio streamed directly]")

        # --- выклік Gradio TTS (Standard Mode) ------------------------------------------------
        if speaker_audio_path:
            if not os.path.exists(speaker_audio_path):
                raise FileNotFoundError(f"File for cloning not found: {speaker_audio_path}")
            result_path = gradio_client.predict(
                belarusian_story=text,
                speaker_audio_file=handle_file(speaker_audio_path),
                api_name="/predict",
            )
        else:
            result_path = gradio_client.predict(
                belarusian_story=text,
                speaker_audio_file=None,
                api_name="/predict",
            )

        if not result_path or not os.path.exists(result_path):
            raise ConnectionError("TTS API did not return a WAV file.")

        # --- чытаем WAV --------------------------------------------------------
        with open(result_path, "rb") as f:
            audio_bytes = f.read()

        # --- ствараем Part і захоўваем як артэфакт ----------------------------
        audio_part = types.Part.from_bytes(data=audio_bytes, mime_type="audio/wav")
        artifact_part = await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio_part,
        )

        return artifact_part  # ⬅️ вяртаем Part з artifact (без inline_data)

    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        # вяртаем тэкставую памылку, каб агент мог апрацаваць
        return types.Part(text=f"Памылка пры сінтэзе маўлення: {exc!r}")

    finally:
        # --- ачышчаем часовы файл --------------------------------------------
        if result_path and os.path.exists(result_path):
            try:
                os.remove(result_path)
            except OSError as exc:
                log.error(f"Не атрымалася выдаліць {result_path}: {exc}")


# ────────────────────────── global queues for voice streaming ─────────────
voice_queues: Dict[str, Tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = {}

def register_voice_user(user_id: str, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
    voice_queues[user_id] = (queue, loop)
    log.info(f"Registered voice queue for user {user_id}")

def unregister_voice_user(user_id: str):
    if user_id in voice_queues:
        del voice_queues[user_id]
        log.info(f"Unregistered voice queue for user {user_id}")

def looks_like_base64(s: str) -> bool:
    """Check if string looks like base64 (heuristic)."""
    if not isinstance(s, str):
        return False
    if s.startswith("http://") or s.startswith("https://"):
        return False
    if s.startswith("data:"):
        return True
    # If it is long and continuous, likely base64
    if len(s) > 100 and not any(c.isspace() for c in s):
        return True
    return False

async def stream_speech(text: str, speaker_audio_path: Optional[str] = None) -> AsyncGenerator[bytes, None]:
    """
    Стрымінг аўдыя праз BexttsAssist.
    Вяртае генератар, які yield-зіць байты аўдыя (WAV chunk).
    """
    if not voice_client:
        log.error("Voice client (BexttsAssist) is not initialized. Cannot stream TTS.")
        return
    
    import asyncio
    import queue
    import threading
    import struct
    
    loop = asyncio.get_running_loop()
    
    log.info(f"Streaming TTS via BexttsAssist. Text length: {len(text)}. First 100 chars: {text[:100]}")
    
    # Queue to bridge the blocking thread and async generator
    chunk_queue = queue.Queue()
    SENTINEL_DONE = object()
    
    def producer_thread():
        try:
            audio_input = handle_file(speaker_audio_path) if speaker_audio_path else None
            # Use submit() to get an iterator over yields (streaming)
            job = voice_client.submit(
                text_input=text,
                speaker_audio=audio_input,
                api_name="/text_to_speech"
            )
            
            # Iterate over updates from the job
            for result in job:
                chunk_queue.put(result)
                
        except Exception as e:
            log.error(f"BexttsAssist prediction error: {e}")
            traceback.print_exc()
        finally:
            chunk_queue.put(SENTINEL_DONE)

    # Start the blocking Gradio client interaction in a separate thread
    t = threading.Thread(target=producer_thread, daemon=True)
    t.start()
    
    def add_wav_header(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1) -> bytes:
        """Add WAV header to raw PCM data (Float32)."""
        byte_count = len(pcm_data)
        # 36 bytes for header info + data length
        header = struct.pack('<4sI4s4sIHHIIHH4sI', 
            b'RIFF',
            byte_count + 36,
            b'WAVE',
            b'fmt ',
            16,              # Subchunk1Size
            3,               # AudioFormat: 3 for IEEE Float
            channels,        # NumChannels
            sample_rate,     # SampleRate
            sample_rate * channels * 4, # ByteRate
            channels * 4,    # BlockAlign
            32,              # BitsPerSample (Float32)
            b'data',
            byte_count
        )
        return header + pcm_data

    # Helper to process a single result item (path or base64) and yield bytes
    def process_item_sync(item):
        path_to_read = None
        bytes_to_yield = None
        
        if isinstance(item, str):
            if os.path.exists(item):
                path_to_read = item
            elif looks_like_base64(item):
                try:
                    bytes_to_yield = base64.b64decode(item)
                except: pass
        
        if bytes_to_yield:
             if not bytes_to_yield.startswith(b'RIFF'):
                 # Add header if raw
                 bytes_to_yield = add_wav_header(bytes_to_yield)
             return bytes_to_yield
        
        elif path_to_read:
            file_size = os.path.getsize(path_to_read)
            # log.info(f"Yielding audio file: {path_to_read} ({file_size} bytes)")
            with open(path_to_read, "rb") as f:
                content = f.read()
            try:
                os.remove(path_to_read)
            except: pass
            return content
        return None

    # Consumption loop
    while True:
        # Run queue.get in executor to avoid blocking the event loop
        result = await loop.run_in_executor(None, chunk_queue.get)
        
        if result is SENTINEL_DONE:
            break
            
        # Log result type roughly
        # with open("tts_debug.log", "a", encoding="utf-8") as f:
        #     f.write(f"Stream result: {str(result)[:200]}\n")

        # Iterate over result content (tuple or single)
        items_to_process = result if isinstance(result, (list, tuple)) else [result]
        
        for item in items_to_process:
            audio_chunk = process_item_sync(item)
            if audio_chunk:
                log.info(f"Yielding audio chunk ({len(audio_chunk)} bytes)")
                yield audio_chunk

    log.info("Finished streaming TTS.")



# ────────────────────────── рэгістрацыя ў ADK ────────────────────────────
synthesize_speech_tool = FunctionTool(func=synthesize_speech)
