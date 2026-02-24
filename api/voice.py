# api/voice.py
"""
WebSocket endpoint для рэальнага галасавога ўзаемадзеяння з агентам.
"""

from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
import json
import logging
import re
import struct
import time
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.genai import types

import config

# Regex for detecting sentence boundaries
# Removed `$` anchor so it finds boundaries anywhere in the string, followed by whitespace or newline
_SENTENCE_END_RE = re.compile(r'[.!?…\n]+[\s»")\]]+')
from api.deps import adk_service, get_genai_client
from tools.text_to_speech_tool import register_voice_user, unregister_voice_user, stream_speech

log = logging.getLogger("app")

router = APIRouter(tags=["voice"])

# Global dictionary to track active voice tasks for interruption
active_voice_tasks: Dict[str, asyncio.Task] = {}

# Sample rate for local XTTS
LOCAL_SAMPLE_RATE = 24000


# ---------------------------------------------------------------------
# Утыліты
# ---------------------------------------------------------------------

def _create_wav_header(data_len: int) -> bytes:
    """Стварае WAV-загаловак для PCM 16kHz 16-bit Mono."""
    return struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', data_len + 36, b'WAVE',
        b'fmt ', 16, 1, 1, 16000, 32000, 2, 16,
        b'data', data_len,
    )


async def _send_audio_chunk(websocket: WebSocket, chunk: bytes, chunk_idx: int):
    """Send audio chunk via WebSocket. Local mode = base64 PCM JSON, API mode = binary WAV."""
    if config.TTS_MODE == "local":
        b64_data = base64.b64encode(chunk).decode('ascii')
        samples = len(chunk) // 4  # Float32 = 4 bytes/sample
        await websocket.send_json({
            "type": "audio_pcm",
            "data": b64_data,
            "sr": LOCAL_SAMPLE_RATE,
            "n": chunk_idx,
            "samples": samples,
        })
    else:
        await websocket.send_bytes(chunk)


# ---------------------------------------------------------------------
# Simple Voice Agent (прамы выклік Gemini)
# ---------------------------------------------------------------------

async def _handle_simple_voice(
    audio_data: bytes,
    websocket: WebSocket,
    audio_queue: asyncio.Queue,
    send_perf: callable,
    start_ts: float,
):
    """Апрацоўка голасу праз Simple Voice Agent (прамы Gemini)."""
    gen_start = time.time()
    await send_perf(
        "llm_start",
        "🤖 Запуск LLM мадэлі",
        detail=f"Мадэль: {config.SIMPLE_VOICE_MODEL}",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    client = get_genai_client()
    prompt = config.SIMPLE_VOICE_SYSTEM_PROMPT

    response_stream = await client.aio.models.generate_content_stream(
        model=config.SIMPLE_VOICE_MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        inline_data=types.Blob(
                            mime_type="audio/wav",
                            data=audio_data,
                        )
                    )
                ],
            )
        ],
        config=types.GenerateContentConfig(
            system_instruction=prompt,
            temperature=0.7,
        ),
    )

    await send_perf(
        "llm_stream_started",
        "📡 Стрым LLM пачаўся",
        detail=f"Час да старту стрыму: {(time.time() - gen_start)*1000:.0f} мс",
        duration_ms=round((time.time() - gen_start) * 1000),
    )

    text_buffer = ""
    sentence_buffer = ""
    first_token = True
    sent_first_audio_chunk = False

    # Internal queue for sentences to be processed by TTS
    tts_sentence_queue: asyncio.Queue = asyncio.Queue()

    async def tts_worker():
        nonlocal sent_first_audio_chunk
        tts_gen_start = None
        tts_chunk_count = 0
        try:
            while True:
                sentence = await tts_sentence_queue.get()
                if sentence is None:
                    break  # Sentinel

                if tts_gen_start is None:
                    tts_gen_start = time.time()
                    await send_perf(
                        "tts_start",
                        "🔊 Пачатак TTS генерацыі",
                        detail=f"Даўжыня тэксту: {len(sentence)} сімвалаў | Рэжым: {config.TTS_MODE}",
                        duration_ms=round((time.time() - start_ts) * 1000),
                    )

                t_sentence_start = time.time()
                log.info(f"[VOICE·TIMING] TTS Worker: sentence={len(sentence)} chars: {sentence[:50]}...")
                sentence_chunk_count = 0

                async for audio_chunk in stream_speech(sentence):
                    tts_chunk_count += 1
                    sentence_chunk_count += 1

                    if not sent_first_audio_chunk:
                        pipeline_ms = (time.time() - start_ts) * 1000
                        tts_ms = (time.time() - tts_gen_start) * 1000
                        chunk_info = ""
                        if config.TTS_MODE == "local":
                            samples = len(audio_chunk) // 4
                            chunk_info = f" | chunk={samples} samples ({samples/LOCAL_SAMPLE_RATE*1000:.0f} ms audio)"

                        await send_perf(
                            "tts_first_chunk",
                            "🔊 Першы аўдыя чанк TTS адпраўлены",
                            detail=f"Поўная затрымка пайплайна: {pipeline_ms:.0f} мс | "
                                   f"Затрымка TTS: {tts_ms:.0f} мс{chunk_info}",
                            duration_ms=round(pipeline_ms),
                        )
                        log.info(f"[VOICE·TIMING] 🎵 First audio chunk sent: pipeline={pipeline_ms:.0f} ms, tts={tts_ms:.0f} ms")
                        sent_first_audio_chunk = True

                    await audio_queue.put(audio_chunk)

                log.info(f"[VOICE·TIMING] Sentence done: {sentence_chunk_count} chunks in {(time.time()-t_sentence_start)*1000:.0f} ms")
                tts_sentence_queue.task_done()
        except Exception as e:
            log.error(f"TTS Worker Error: {e}")
        finally:
            if tts_gen_start:
                await send_perf(
                    "tts_complete",
                    "✅ TTS генерацыя завершана",
                    detail=f"Час TTS: {(time.time() - tts_gen_start)*1000:.0f} мс | Чанкаў: {tts_chunk_count}",
                    duration_ms=round((time.time() - tts_gen_start) * 1000),
                )

    worker_task = asyncio.create_task(tts_worker())

    try:
        async for chunk in response_stream:
            if chunk.text:
                if first_token:
                    await send_perf(
                        "llm_first_token",
                        "✍️ Першы токен LLM",
                        detail=f"Затрымка да першага токена: {(time.time() - gen_start)*1000:.0f} мс",
                        duration_ms=round((time.time() - gen_start) * 1000),
                    )
                    first_token = False

                text_buffer += chunk.text
                sentence_buffer += chunk.text

                await websocket.send_json({
                    "type": "response",
                    "text": text_buffer,
                })

                # ── Sentence-level TTS ──
                matches = list(_SENTENCE_END_RE.finditer(sentence_buffer))
                if matches:
                    last_match = matches[-1]
                    split_idx = last_match.end()
                    ready = sentence_buffer[:split_idx].strip()
                    if len(ready) >= 15:
                        log.info(f"[VOICE·TIMING] Sentence ready for TTS ({len(ready)} chars): {ready[:60]}...")
                        await tts_sentence_queue.put(ready)
                        sentence_buffer = sentence_buffer[split_idx:]

        # Process remaining text
        if sentence_buffer.strip():
            await tts_sentence_queue.put(sentence_buffer.strip())

        # Wait for all TTS to finish
        await tts_sentence_queue.put(None)  # Sentinel
        await worker_task
    finally:
        if not worker_task.done():
            worker_task.cancel()

    await send_perf(
        "llm_complete",
        "✅ LLM стрым завершаны",
        detail=f"Агульны час генерацыі: {(time.time() - gen_start)*1000:.0f} мс",
        duration_ms=round((time.time() - gen_start) * 1000),
    )


# ---------------------------------------------------------------------
# ADK Agent Voice (праз router_agent)
# ---------------------------------------------------------------------

async def _handle_adk_voice(
    audio_data: bytes,
    websocket: WebSocket,
    session_id: str,
    user_id: str,
    send_perf: callable,
    start_ts: float,
):
    """Апрацоўка голасу праз ADK agent."""
    collected_text = []

    async for ev in adk_service.run_agent_stream(
        session_id=session_id,
        user_id=user_id,
        text=None,
        file_data=audio_data,
        mime_type="audio/wav",
    ):
        if ev.is_final_response() and ev.content:
            text_parts = [p.text for p in ev.content.parts if p.text]
            if text_parts:
                full_text = "\n".join(text_parts)
                if "[Audio streamed directly]" not in full_text:
                    collected_text.append(full_text)
                    await websocket.send_json({
                        "type": "response",
                        "text": full_text,
                    })

        if ev.actions and ev.actions.artifact_delta:
            for filename, version in ev.actions.artifact_delta.items():
                try:
                    part = await adk_service.artifact_service.load_artifact(
                        app_name=adk_service.app_name,
                        user_id=user_id,
                        session_id=session_id,
                        filename=filename,
                        version=version,
                    )
                    if part and getattr(part, "inline_data", None):
                        if getattr(part.inline_data, "mime_type", "").startswith("audio"):
                            await websocket.send_bytes(part.inline_data.data)
                except Exception as e:
                    log.error(f"Error loading audio artifact: {e}")

    # Stream TTS for collected text (ADK path)
    if collected_text:
        final_text = " ".join(collected_text)
        await send_perf(
            "tts_start",
            "🔊 Пачатак TTS генерацыі",
            detail=f"Даўжыня тэксту: {len(final_text)} сімвалаў",
            duration_ms=round((time.time() - start_ts) * 1000),
        )
        tts_start = time.time()
        first_chunk = True
        chunk_count = 0
        try:
            async for chunk in stream_speech(final_text):
                chunk_count += 1
                if first_chunk:
                    await send_perf(
                        "tts_first_chunk",
                        "🔊 Першы аўдыя чанк TTS",
                        detail=f"Затрымка TTS: {(time.time() - tts_start)*1000:.0f} мс",
                        duration_ms=round((time.time() - tts_start) * 1000),
                    )
                    first_chunk = False
                await _send_audio_chunk(websocket, chunk, chunk_count)
        except Exception as tts_err:
            log.error(f"TTS streaming error: {tts_err}")

    return collected_text


# ---------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------

@router.websocket("/api/voice")
async def voice_websocket(websocket: WebSocket, user_id: str = "voice_user"):
    """Real-time voice conversation with the agent."""
    await websocket.accept()
    log.info(f"Voice WebSocket connected for user {user_id}")

    # Send streaming config to client
    await websocket.send_json({
        "type": "voice_config",
        "tts_mode": config.TTS_MODE,
        "sample_rate": LOCAL_SAMPLE_RATE,
        "script_buffer_size": config.TTS_SCRIPT_BUFFER_SIZE,
        "playback_min_buffer_ms": config.TTS_PLAYBACK_MIN_BUFFER_MS,
        "playback_empty_grace_ms": config.TTS_PLAYBACK_EMPTY_GRACE_MS,
    })

    session_id = await adk_service.get_or_create_session(user_id)

    # Create queue for streaming audio and register user
    audio_queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    register_voice_user(user_id, audio_queue, loop)

    # Accumulator for continuous audio upload
    audio_accumulator = bytearray()

    async def audio_sender():
        """Consumes audio chunks from queue and sends to websocket."""
        chunk_count = 0
        try:
            while True:
                chunk = await audio_queue.get()
                if chunk is None:
                    break  # Sentinel
                chunk_count += 1

                t0 = time.time()
                await _send_audio_chunk(websocket, chunk, chunk_count)
                send_ms = (time.time() - t0) * 1000

                if chunk_count <= 3:
                    info = ""
                    if config.TTS_MODE == "local":
                        samples = len(chunk) // 4
                        info = f" | {samples} samples ({samples/LOCAL_SAMPLE_RATE*1000:.0f} ms audio)"
                    log.info(f"[VOICE·TIMING] audio_sender chunk #{chunk_count}: send={send_ms:.1f} ms{info}")

                audio_queue.task_done()
        except Exception as e:
            log.error(f"Audio sender error: {e}")
        finally:
            log.info(f"[VOICE·TIMING] audio_sender finished: {chunk_count} chunks total")

    sender_task = asyncio.create_task(audio_sender())

    async def process_voice_message(audio_data: bytes):
        """Апрацоўка аўдыя паведамлення і адпраўка стрымінгавага адказу."""
        try:
            start_ts = time.time()
            log.info(f"[VOICE·TIMING] ── Voice pipeline start ── audio={len(audio_data)} bytes")

            async def send_perf(event: str, label: str, detail: str = "", duration_ms: int = 0):
                """Send a structured perf log event to client."""
                now = datetime.now(timezone.utc)
                msg = {
                    "type": "perf_log",
                    "event": event,
                    "label": label,
                    "detail": detail,
                    "timestamp": now.isoformat(),
                    "elapsed_ms": round((time.time() - start_ts) * 1000),
                    "duration_ms": duration_ms,
                }
                log.info(f"[Perf] {label} | {detail} | elapsed={msg['elapsed_ms']}ms")
                if config.SIMPLE_VOICE_DEBUG_TIMESTAMPS:
                    try:
                        await websocket.send_json(msg)
                    except Exception:
                        pass

            await send_perf(
                "audio_received",
                "📥 Аўдыё атрымана серверам",
                detail=f"Памер: {len(audio_data)} байт",
            )
            await websocket.send_json({"type": "processing"})

            if config.SIMPLE_VOICE_AGENT:
                await _handle_simple_voice(
                    audio_data, websocket, audio_queue, send_perf, start_ts
                )
            else:
                await _handle_adk_voice(
                    audio_data, websocket, session_id, user_id, send_perf, start_ts
                )

            await send_perf(
                "pipeline_complete",
                "🏁 Пайплайн завершаны",
                detail=f"Агульны час: {(time.time() - start_ts)*1000:.0f} мс",
                duration_ms=round((time.time() - start_ts) * 1000),
            )

        except Exception as e:
            log.exception(f"Error in process_voice_message: {e}")
            try:
                await websocket.send_json({"type": "error", "message": str(e)})
            except Exception:
                pass

    # ── Main receive loop ──
    try:
        while True:
            data = await websocket.receive()

            if data.get("type") == "websocket.disconnect":
                log.info(f"WebSocket disconnect received for user {user_id}")
                break

            if "bytes" in data:
                audio_accumulator.extend(data["bytes"])

            elif "text" in data:
                msg = json.loads(data["text"])
                msg_type = msg.get("type")

                if msg_type == "end_audio":
                    if not audio_accumulator:
                        continue

                    log.info(
                        f"Received end_audio. Accumulated {len(audio_accumulator)} "
                        f"bytes. Starting processing..."
                    )

                    full_wav = (
                        _create_wav_header(len(audio_accumulator))
                        + audio_accumulator
                    )

                    # Cancel previous task if still running
                    if user_id in active_voice_tasks and not active_voice_tasks[user_id].done():
                        active_voice_tasks[user_id].cancel()

                    task = asyncio.create_task(process_voice_message(full_wav))
                    active_voice_tasks[user_id] = task

                    audio_accumulator = bytearray()

                elif msg_type == "interrupt":
                    log.info(f"Interruption received for user {user_id}")
                    while not audio_queue.empty():
                        try:
                            audio_queue.get_nowait()
                        except Exception:
                            pass

                    if user_id in active_voice_tasks:
                        active_voice_tasks[user_id].cancel()
                        del active_voice_tasks[user_id]
                    await websocket.send_json({"type": "interruption_handshake"})

    except WebSocketDisconnect:
        log.info(f"Voice WebSocket disconnected for user {user_id}")
    except Exception as e:
        log.exception(f"Voice WebSocket error: {e}")
    finally:
        unregister_voice_user(user_id)
        if sender_task:
            sender_task.cancel()
        if user_id in active_voice_tasks:
            active_voice_tasks[user_id].cancel()
            del active_voice_tasks[user_id]
