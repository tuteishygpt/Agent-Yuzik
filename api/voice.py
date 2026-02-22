# api/voice.py
"""
WebSocket endpoint для рэальнага галасавога ўзаемадзеяння з агентам.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import time
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.genai import types

import config
from api.deps import adk_service, get_genai_client
from tools.text_to_speech_tool import register_voice_user, unregister_voice_user, stream_speech

log = logging.getLogger("app")

router = APIRouter(tags=["voice"])

# Global dictionary to track active voice tasks for interruption
active_voice_tasks: Dict[str, asyncio.Task] = {}


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


# ---------------------------------------------------------------------
# Simple Voice Agent (прамы выклік Gemini)
# ---------------------------------------------------------------------

async def _handle_simple_voice(
    audio_data: bytes,
    websocket: WebSocket,
    audio_queue: asyncio.Queue,
    perf_log,
    start_ts: float,
):
    """Апрацоўка голасу праз Simple Voice Agent (прамы Gemini)."""
    gen_start = time.time()
    perf_log(
        f"[Perf] Using Simple Voice Agent (Model: {config.SIMPLE_VOICE_MODEL}). "
        f"Overhead: {time.time() - start_ts:.3f}s"
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

    perf_log(f"[Perf] Gemini Stream Started. TTFT: {time.time() - gen_start:.3f}s")

    text_buffer = ""
    sentence_buffer = ""
    first_token = True
    sent_first_audio_chunk = False

    # Internal queue for sentences to be processed by TTS
    tts_sentence_queue: asyncio.Queue = asyncio.Queue()

    async def tts_worker():
        nonlocal sent_first_audio_chunk
        try:
            while True:
                sentence = await tts_sentence_queue.get()
                if sentence is None:
                    break  # Sentinel

                log.info(f"TTS Worker: Processing sentence: {sentence[:30]}...")
                async for audio_chunk in stream_speech(sentence):
                    if not sent_first_audio_chunk:
                        perf_log(
                            f"[Perf] First TTS Chunk sent. Pipeline Latency: "
                            f"{time.time() - start_ts:.3f}s"
                        )
                        sent_first_audio_chunk = True
                    await audio_queue.put(audio_chunk)
                tts_sentence_queue.task_done()
        except Exception as e:
            log.error(f"TTS Worker Error: {e}")

    worker_task = asyncio.create_task(tts_worker())

    try:
        async for chunk in response_stream:
            if chunk.text:
                if first_token:
                    perf_log(
                        f"[Perf] First LLM Token. Latency: "
                        f"{time.time() - gen_start:.3f}s"
                    )
                    first_token = False

                text_buffer += chunk.text
                sentence_buffer += chunk.text

                await websocket.send_json({
                    "type": "response",
                    "text": text_buffer,
                })

        # Process remaining text in buffer
        if sentence_buffer.strip():
            await tts_sentence_queue.put(sentence_buffer)

        # Wait for all TTS to finish
        await tts_sentence_queue.put(None)  # Sentinel
        await worker_task
    finally:
        if not worker_task.done():
            worker_task.cancel()

    perf_log(
        f"[Perf] LLM Stream Complete. Total Gen Time: "
        f"{time.time() - gen_start:.3f}s"
    )


# ---------------------------------------------------------------------
# ADK Agent Voice (праз router_agent)
# ---------------------------------------------------------------------

async def _handle_adk_voice(
    audio_data: bytes,
    websocket: WebSocket,
    session_id: str,
    user_id: str,
    perf_log,
    start_ts: float,
):
    """Апрацоўка голасу праз ADK agent (legacy/non-simple)."""
    collected_text = []

    async for ev in adk_service.run_agent_stream(
        session_id=session_id,
        user_id=user_id,
        text=None,
        file_data=audio_data,
        mime_type="audio/wav",
    ):
        # Handle text response
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

        # Handle generated audio artifacts
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

    # Stream TTS for collected text (ADK path only)
    if collected_text:
        final_text = " ".join(collected_text)
        perf_log(
            f"[Perf] Streaming TTS for voice response. Text Len: {len(final_text)}. "
            f"Time from start: {time.time() - start_ts:.3f}s"
        )
        tts_start = time.time()
        first_chunk = True
        try:
            async for chunk in stream_speech(final_text):
                if first_chunk:
                    perf_log(
                        f"[Perf] First TTS Audio Chunk Yielded. TTS Latency: "
                        f"{time.time() - tts_start:.3f}s"
                    )
                    first_chunk = False
                await websocket.send_bytes(chunk)
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

    session_id = await adk_service.get_or_create_session(user_id)

    # Create queue for streaming audio and register user
    audio_queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    register_voice_user(user_id, audio_queue, loop)

    # Accumulator for continuous audio upload
    audio_accumulator = bytearray()

    async def audio_sender():
        """Consumes audio chunks from queue and sends to websocket."""
        try:
            while True:
                chunk = await audio_queue.get()
                if chunk is None:
                    break  # Sentinel
                await websocket.send_bytes(chunk)
                audio_queue.task_done()
        except Exception as e:
            log.error(f"Audio sender error: {e}")

    sender_task = asyncio.create_task(audio_sender())

    async def process_voice_message(audio_data: bytes):
        """Апрацоўка аўдыя паведамлення і адпраўка стрымінгавага адказу."""
        try:
            start_ts = time.time()
            perf_logs = []

            def perf_log(msg: str):
                log.info(msg)
                perf_logs.append(msg)

            perf_log(
                f"[Perf] Server: Audio Received. Size: {len(audio_data)} bytes. "
                f"TS: {start_ts}"
            )
            await websocket.send_json({"type": "processing"})

            if config.SIMPLE_VOICE_AGENT:
                await _handle_simple_voice(
                    audio_data, websocket, audio_queue, perf_log, start_ts
                )
            else:
                await _handle_adk_voice(
                    audio_data, websocket, session_id, user_id, perf_log, start_ts
                )

            # Send Debug Info if enabled
            if config.SIMPLE_VOICE_DEBUG_TIMESTAMPS:
                debug_msg = "\n".join(perf_logs)
                label = "Streamed" if config.SIMPLE_VOICE_AGENT else ""
                await websocket.send_json({
                    "type": "response",
                    "text": f"\n\n--- Debug Timestamps {label} ---\n{debug_msg}",
                })

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
