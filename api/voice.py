# api/voice.py
"""
WebSocket endpoint для рэальнага галасавога ўзаемадзеяння з агентам.

This is the thin routing layer. Business logic lives in:
  - voice_simple.py  — Simple Voice Agent (direct Gemini → TTS)
  - voice_adk.py     — ADK Agent voice handler
  - voice_perf.py    — Structured performance logging
  - voice_utils.py   — Shared utilities (WAV, binary protocol)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import config
from api.auth import (
    AuthenticatedUser,
    WebSocketAuthenticationError,
    authenticate_websocket_message,
)
from api.deps import adk_service
from api.voice_utils import (
    LOCAL_SAMPLE_RATE,
    create_wav_header,
    send_audio_chunk,
    extract_end_marker,
    ensure_wav,
)
from api.voice_perf import PerfLogger
from api.voice_simple import handle_simple_voice
from api.voice_adk import handle_adk_voice
from api.teacher_mode.service import controller as teacher_controller
from tools.text_to_speech_tool import register_voice_user, unregister_voice_user

log = logging.getLogger("app.voice")

router = APIRouter(tags=["voice"])

# Global dictionary to track active voice tasks for interruption
active_voice_tasks: Dict[str, asyncio.Task] = {}


async def _receive_authenticated_user(websocket: WebSocket) -> AuthenticatedUser:
    initial_message = await websocket.receive()

    if initial_message.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect()

    if "text" not in initial_message:
        raise WebSocketAuthenticationError("authentication required before voice messages")

    try:
        payload = json.loads(initial_message["text"])
    except json.JSONDecodeError as exc:
        raise WebSocketAuthenticationError("authentication required before voice messages") from exc

    return authenticate_websocket_message(payload)


def _authenticated_user_log_label(authenticated_user: AuthenticatedUser) -> str | None:
    email = authenticated_user.claims.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip()
    return None


# ─── Audio sender (queue → WebSocket) ───────────────────────────────

async def _audio_sender(audio_queue: asyncio.Queue, websocket: WebSocket):
    """Consume audio chunks from queue and send to WebSocket."""
    chunk_count = 0
    total_send_ms = 0.0
    max_send_ms = 0.0
    total_wait_ms = 0.0
    t_sender_start = time.time()
    first_chunk_sent = False

    try:
        while True:
            t_wait = time.time()
            chunk = await audio_queue.get()
            wait_ms = (time.time() - t_wait) * 1000
            total_wait_ms += wait_ms

            if chunk is None:
                break  # Sentinel

            chunk_count += 1
            t0 = time.time()
            await send_audio_chunk(websocket, chunk, chunk_count)
            send_ms = (time.time() - t0) * 1000
            total_send_ms += send_ms
            max_send_ms = max(max_send_ms, send_ms)

            if config.TTS_MODE == "local":
                samples = len(chunk) // 4
                info = f" | {samples} samples ({samples/LOCAL_SAMPLE_RATE*1000:.0f} ms audio)"
            else:
                info = ""

            if not first_chunk_sent:
                first_chunk_sent = True
                log.info(
                    f"[VOICE·TIMING] 📤 audio_sender: FIRST chunk sent! "
                    f"queue_wait={wait_ms:.1f} ms | ws_send={send_ms:.1f} ms{info}"
                )
            elif chunk_count <= 5 or send_ms > 10:
                log.info(
                    f"[VOICE·TIMING] audio_sender #{chunk_count}: "
                    f"wait={wait_ms:.1f} ms | send={send_ms:.1f} ms{info}"
                )

            audio_queue.task_done()
    except Exception as e:
        log.error(f"Audio sender error: {e}")
    finally:
        total_ms = (time.time() - t_sender_start) * 1000
        avg_send = total_send_ms / chunk_count if chunk_count else 0
        log.info(
            f"[VOICE·TIMING] audio_sender finished: {chunk_count} chunks | "
            f"total={total_ms:.0f} ms | send_avg={avg_send:.1f} ms | "
            f"send_max={max_send_ms:.1f} ms | wait_total={total_wait_ms:.0f} ms"
        )


# ─── Voice message processor ────────────────────────────────────────

async def _process_voice_message(
    audio_data: bytes,
    websocket: WebSocket,
    audio_queue: asyncio.Queue,
    session_id: str,
    user_id: str,
    user_label: str | None = None,
):
    """Process a complete audio message and stream response."""
    try:
        start_ts = time.time()
        log.info("[VOICE·TIMING] ══════════════════════════════════════")
        log.info(f"[VOICE·TIMING] ▶ Voice pipeline START | audio={len(audio_data)} bytes")

        perf = PerfLogger(websocket, start_ts)

        # ── Step 1: Audio received ──
        is_wav = audio_data[:4] == b'RIFF'
        await perf(
            "audio_received",
            "📥 Аўдыё атрымана серверам",
            detail=f"Памер: {len(audio_data)} байт | Фармат: {'WAV' if is_wav else 'PCM+header'}",
        )
        await websocket.send_json({"type": "processing"})

        # ── Step 2: Dispatch to handler ──
        if config.SIMPLE_VOICE_AGENT:
            await handle_simple_voice(
                audio_data,
                websocket,
                audio_queue,
                perf,
                user_id,
                ws_session_id=session_id,
                user_label=user_label,
            )
        else:
            await handle_adk_voice(audio_data, websocket, session_id, user_id, perf)

        # ── Step 3: Pipeline complete ──
        total_ms = (time.time() - start_ts) * 1000
        await perf(
            "pipeline_complete",
            "🏁 Пайплайн завершаны",
            detail=f"Агульны час: {total_ms:.0f} мс",
            duration_ms=round(total_ms),
        )
        log.info(f"[VOICE·TIMING] ◼ Voice pipeline END | total={total_ms:.0f} ms")
        log.info("[VOICE·TIMING] ══════════════════════════════════════")

    except Exception as e:
        log.exception(f"Error in process_voice_message: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


# ─── WebSocket endpoint ─────────────────────────────────────────────

@router.websocket("/api/voice")
async def voice_websocket(websocket: WebSocket):
    """Real-time voice conversation with the agent."""
    await websocket.accept()
    ws_session_id = str(uuid.uuid4())
    sender_task: asyncio.Task | None = None
    user_id: str | None = None
    user_label: str | None = None

    try:
        authenticated_user = await _receive_authenticated_user(websocket)
        user_id = authenticated_user.user_id
        user_label = _authenticated_user_log_label(authenticated_user)
        log.info(f"Voice WebSocket authenticated for user {user_id}, session {ws_session_id}")

        if adk_service is None:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "ADK service is unavailable",
                }
            )
            await websocket.close(code=1011)
            return

        await websocket.send_json(
            {
                "type": "voice_config",
                "tts_mode": config.TTS_MODE,
                "sample_rate": LOCAL_SAMPLE_RATE,
                "script_buffer_size": config.TTS_SCRIPT_BUFFER_SIZE,
                "playback_min_buffer_ms": config.TTS_PLAYBACK_MIN_BUFFER_MS,
                "playback_empty_grace_ms": config.TTS_PLAYBACK_EMPTY_GRACE_MS,
            }
        )

        session_id = await adk_service.get_or_create_session(user_id)
        audio_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        loop = asyncio.get_running_loop()
        register_voice_user(ws_session_id, audio_queue, loop)
        audio_accumulator = bytearray()
        sender_task = asyncio.create_task(_audio_sender(audio_queue, websocket))

        def _start_processing(audio_bytes: bytes):
            """Start voice processing task from audio bytes."""
            nonlocal audio_accumulator
            full_wav = ensure_wav(audio_bytes)
            request_id = str(uuid.uuid4())

            if ws_session_id in active_voice_tasks and not active_voice_tasks[ws_session_id].done():
                log.info(f"Cancelling previous task for session {ws_session_id}")
                active_voice_tasks[ws_session_id].cancel()

            log.info(f"Starting request {request_id} for session {ws_session_id}")
            task = asyncio.create_task(
                _process_voice_message(
                    full_wav,
                    websocket,
                    audio_queue,
                    session_id,
                    user_id,
                    user_label=user_label,
                )
            )
            active_voice_tasks[ws_session_id] = task
            audio_accumulator = bytearray()

        while True:
            data = await websocket.receive()

            if data.get("type") == "websocket.disconnect":
                log.info(f"WebSocket disconnect received for user {user_id}")
                break

            if "bytes" in data:
                raw = data["bytes"]
                audio_data, client_ts = extract_end_marker(raw)
                if audio_data is not None:
                    log.info(
                        f"Received combined WAV+END ({len(audio_data)} bytes audio). "
                        f"Starting processing immediately..."
                    )
                    _start_processing(audio_data)
                else:
                    audio_accumulator.extend(raw)

            elif "text" in data:
                msg = json.loads(data["text"])
                msg_type = msg.get("type")

                if msg_type == "end_audio":
                    if not audio_accumulator:
                        continue
                    log.info(
                        f"Received end_audio (legacy). Accumulated {len(audio_accumulator)} "
                        f"bytes. Starting processing..."
                    )
                    _start_processing(bytes(audio_accumulator))

                elif msg_type == "interrupt":
                    log.info(f"Interruption received for session {ws_session_id}")
                    while not audio_queue.empty():
                        try:
                            audio_queue.get_nowait()
                        except Exception:
                            pass

                    if ws_session_id in active_voice_tasks:
                        active_voice_tasks[ws_session_id].cancel()
                        del active_voice_tasks[ws_session_id]
                    await websocket.send_json({"type": "interruption_handshake"})

                elif msg_type == "teacher_start_lesson":
                    lesson_id = msg.get("lesson_id")
                    if not lesson_id:
                        await websocket.send_json({"type": "error", "message": "lesson_id is required"})
                        continue
                    state = teacher_controller.start_lesson(
                        session_id=session_id,
                        user_id=user_id,
                        lesson_id=lesson_id,
                    )
                    lesson = teacher_controller.lesson_store.get_lesson(lesson_id)
                    await websocket.send_json(
                        {
                            "type": "teacher_mode_started",
                            "lesson_id": state.lesson_id,
                            "step_id": state.current_step_id,
                            "prompt": lesson.steps[0].prompt if lesson.steps else "",
                            "mode": "teacher",
                        }
                    )

                elif msg_type == "teacher_stop_lesson":
                    teacher_controller.stop_lesson(session_id=session_id, user_id=user_id)
                    await websocket.send_json({"type": "teacher_mode_stopped", "mode": "assistant"})

    except WebSocketAuthenticationError as exc:
        log.warning(
            f"Voice WebSocket auth rejected for session {ws_session_id}: "
            f"{exc.message} (code={exc.close_code})"
        )
        await websocket.send_json({"type": "error", "message": exc.message})
        await websocket.close(code=exc.close_code)
    except WebSocketDisconnect:
        if user_id:
            log.info(f"Voice WebSocket disconnected for session {ws_session_id}")
    except Exception as e:
        log.exception(f"Voice WebSocket error for session {ws_session_id}: {e}")
    finally:
        unregister_voice_user(ws_session_id)
        if sender_task:
            sender_task.cancel()
        if ws_session_id in active_voice_tasks:
            active_voice_tasks[ws_session_id].cancel()
            del active_voice_tasks[ws_session_id]
