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
    """Send audio chunk via WebSocket. Local mode = binary PCM, API mode = binary WAV."""
    if config.TTS_MODE == "local":
        # Binary protocol: 4-byte magic "PCM\0" + 4-byte uint32 LE sample count + raw Float32 PCM
        # Eliminates base64 encoding overhead (+33% size) and JSON parsing
        samples = len(chunk) // 4  # Float32 = 4 bytes/sample
        header = struct.pack('<4sI', b'PCM\x00', samples)
        await websocket.send_bytes(header + chunk)
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
    prev_ts = gen_start  # track delta between steps

    await send_perf(
        "llm_start",
        "🤖 Запуск LLM мадэлі",
        detail=f"Мадэль: {config.SIMPLE_VOICE_MODEL} | аўдыё: {len(audio_data)} байт",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    client = get_genai_client()
    prompt = config.SIMPLE_VOICE_SYSTEM_PROMPT

    t_api_call = time.time()
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
    api_call_ms = (time.time() - t_api_call) * 1000

    await send_perf(
        "llm_stream_created",
        "📡 LLM стрым створаны",
        detail=f"API выклік: {api_call_ms:.0f} мс | Ад старту: {(time.time() - start_ts)*1000:.0f} мс",
        duration_ms=round(api_call_ms),
    )
    prev_ts = time.time()

    text_buffer = ""
    sentence_buffer = ""
    first_token = True
    first_sentence_ready = False
    sent_first_audio_chunk = False
    first_tts_dispatched = False             # ці адпраўлены першы кавалак у TTS
    first_tts_dispatch_ts = None             # калі першы кавалак быў дасланы ў чаргу
    group_buffer = ""                        # буфер для групоўкі сказаў пасля першага
    GROUP_LIMIT = 250                        # максімальны памер згрупаванага кавалка
    total_llm_tokens = 0
    llm_first_token_ts = None

    # Internal queue for sentences to be processed by TTS
    tts_sentence_queue: asyncio.Queue = asyncio.Queue()

    async def tts_worker():
        nonlocal sent_first_audio_chunk
        tts_gen_start = None
        tts_chunk_count = 0
        tts_total_audio_samples = 0
        sentence_idx = 0
        try:
            while True:
                t_queue_wait = time.time()
                sentence = await tts_sentence_queue.get()
                queue_wait_ms = (time.time() - t_queue_wait) * 1000
                if sentence is None:
                    break  # Sentinel

                sentence_idx += 1

                if tts_gen_start is None:
                    tts_gen_start = time.time()
                    dispatch_to_worker_ms = (tts_gen_start - first_tts_dispatch_ts) * 1000 if first_tts_dispatch_ts else 0
                    await send_perf(
                        "tts_start",
                        "🔊 Пачатак TTS генерацыі",
                        detail=f"Даўжыня тэксту: {len(sentence)} сімв. | "
                               f"Рэжым: {config.TTS_MODE} | "
                               f"Чарга→worker: {dispatch_to_worker_ms:.0f} мс | "
                               f"Queue wait: {queue_wait_ms:.0f} мс",
                        duration_ms=round((time.time() - start_ts) * 1000),
                    )

                t_sentence_start = time.time()
                log.info(f"[VOICE·TIMING] TTS Worker: sentence #{sentence_idx} ({len(sentence)} chars): {sentence[:80]}...")
                sentence_chunk_count = 0
                first_chunk_in_sentence = True

                async for audio_chunk in stream_speech(sentence):
                    tts_chunk_count += 1
                    sentence_chunk_count += 1

                    chunk_samples = len(audio_chunk) // 4 if config.TTS_MODE == "local" else 0
                    tts_total_audio_samples += chunk_samples

                    if first_chunk_in_sentence:
                        sentence_first_chunk_ms = (time.time() - t_sentence_start) * 1000
                        await send_perf(
                            "tts_sentence_first_chunk",
                            f"🔉 Сказ #{sentence_idx}: першы чанк",
                            detail=f"Inference сказа: {sentence_first_chunk_ms:.0f} мс | "
                                   f"{len(sentence)} сімв. | "
                                   f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
                            duration_ms=round(sentence_first_chunk_ms),
                        )
                        first_chunk_in_sentence = False

                    if not sent_first_audio_chunk:
                        pipeline_ms = (time.time() - start_ts) * 1000
                        tts_ms = (time.time() - tts_gen_start) * 1000
                        llm_to_tts_ms = (tts_gen_start - llm_first_token_ts) * 1000 if llm_first_token_ts else 0
                        chunk_info = ""
                        if config.TTS_MODE == "local":
                            chunk_info = f" | chunk={chunk_samples} samples ({chunk_samples/LOCAL_SAMPLE_RATE*1000:.0f} мс аўдыё)"

                        await send_perf(
                            "tts_first_chunk",
                            "🔊 Першы аўдыя чанк TTS → чарга",
                            detail=f"🏁 Пайплайн: {pipeline_ms:.0f} мс | "
                                   f"TTS: {tts_ms:.0f} мс | "
                                   f"LLM→TTS: {llm_to_tts_ms:.0f} мс{chunk_info}",
                            duration_ms=round(pipeline_ms),
                        )
                        log.info(f"[VOICE·TIMING] 🎵 First audio chunk → queue: pipeline={pipeline_ms:.0f} ms, tts={tts_ms:.0f} ms")
                        sent_first_audio_chunk = True

                    t_put = time.time()
                    await audio_queue.put(audio_chunk)
                    put_ms = (time.time() - t_put) * 1000
                    if put_ms > 5:  # log only if queue put takes >5ms (backpressure)
                        log.info(f"[VOICE·TIMING] ⚠️ audio_queue.put slow: {put_ms:.1f} ms (chunk #{tts_chunk_count})")

                sentence_ms = (time.time() - t_sentence_start) * 1000
                sentence_audio_ms = (tts_total_audio_samples / LOCAL_SAMPLE_RATE * 1000) if config.TTS_MODE == "local" else 0
                log.info(f"[VOICE·TIMING] Sentence #{sentence_idx} done: {sentence_chunk_count} chunks in {sentence_ms:.0f} ms")
                await send_perf(
                    "tts_sentence_done",
                    f"✅ Сказ #{sentence_idx} завершаны",
                    detail=f"{sentence_chunk_count} чанкаў за {sentence_ms:.0f} мс | "
                           f"Čарга wait: {queue_wait_ms:.0f} мс",
                    duration_ms=round(sentence_ms),
                )
                tts_sentence_queue.task_done()
        except Exception as e:
            log.error(f"TTS Worker Error: {e}")
        finally:
            if tts_gen_start:
                total_tts_ms = (time.time() - tts_gen_start) * 1000
                total_audio_ms = tts_total_audio_samples / LOCAL_SAMPLE_RATE * 1000 if config.TTS_MODE == "local" else 0
                rtf = total_tts_ms / total_audio_ms if total_audio_ms > 0 else 0
                await send_perf(
                    "tts_complete",
                    "✅ TTS генерацыя завершана",
                    detail=f"Час TTS: {total_tts_ms:.0f} мс | "
                           f"Чанкаў: {tts_chunk_count} | "
                           f"Аўдыё: {total_audio_ms:.0f} мс | "
                           f"RTF: {rtf:.2f}x | "
                           f"Сказаў: {sentence_idx}",
                    duration_ms=round(total_tts_ms),
                )

    async def _dispatch_to_tts(text: str):
        """Адпраўляе тэкст у чаргу TTS з лагаваннем."""
        nonlocal first_tts_dispatch_ts
        if first_tts_dispatch_ts is None:
            first_tts_dispatch_ts = time.time()
        log.info(f"[VOICE·TIMING] Dispatch to TTS ({len(text)} chars): {text[:80]}...")
        await send_perf(
            "tts_dispatch",
            "✂️ Тэкст → чарга TTS",
            detail=f"({len(text)} сімв.): {text[:120]} | "
                   f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
        )
        await tts_sentence_queue.put(text)

    async def _flush_group_buffer():
        """Адпраўляе назапашаны group_buffer у TTS."""
        nonlocal group_buffer
        if group_buffer.strip():
            await _dispatch_to_tts(group_buffer.strip())
            group_buffer = ""

    worker_task = asyncio.create_task(tts_worker())

    try:
        t_first_iter = time.time()
        chunk_count = 0
        async for chunk in response_stream:
            if chunk.text:
                chunk_count += 1
                total_llm_tokens += 1
                if first_token:
                    llm_first_token_ts = time.time()
                    ttft_ms = (llm_first_token_ts - gen_start) * 1000
                    iter_wait_ms = (llm_first_token_ts - t_first_iter) * 1000
                    await send_perf(
                        "llm_first_token",
                        "✍️ Першы токен LLM",
                        detail=f"TTFT: {ttft_ms:.0f} мс | "
                               f"Чаканне ітэрацыі: {iter_wait_ms:.0f} мс | "
                               f"Тэкст: «{chunk.text[:50]}»",
                        duration_ms=round(ttft_ms),
                    )
                    first_token = False

                text_buffer += chunk.text
                sentence_buffer += chunk.text

                await websocket.send_json({
                    "type": "response",
                    "text": text_buffer,
                })

                # ── Два рэжымы: першы сказ → адразу, наступныя → групуем ──
                matches = list(_SENTENCE_END_RE.finditer(sentence_buffer))
                if matches:
                    last_match = matches[-1]
                    split_idx = last_match.end()
                    ready = sentence_buffer[:split_idx].strip()
                    sentence_buffer = sentence_buffer[split_idx:]

                    if not ready:
                        continue

                    if not first_tts_dispatched:
                        # ── Першы кавалак: накапліваем пакуль не набярэм дастаткова ──
                        group_buffer = (group_buffer + " " + ready).strip() if group_buffer else ready
                        if len(group_buffer) >= config.TTS_FIRST_SEGMENT_LIMIT:
                            if not first_sentence_ready:
                                first_sentence_ready = True
                                sentence_ready_ms = (time.time() - gen_start) * 1000
                                await send_perf(
                                    "llm_first_sentence",
                                    "📝 Першы сказ гатовы для TTS",
                                    detail=f"Час: {sentence_ready_ms:.0f} мс | "
                                           f"{len(group_buffer)} сімв. | "
                                           f"LLM токенаў: {total_llm_tokens} | "
                                           f"Тэкст: «{group_buffer[:80]}»",
                                    duration_ms=round(sentence_ready_ms),
                                )
                            await _dispatch_to_tts(group_buffer)
                            group_buffer = ""
                            first_tts_dispatched = True
                    else:
                        # ── Наступныя сказы: групуем у большыя кавалкі ──
                        if group_buffer and len(group_buffer) + 1 + len(ready) > GROUP_LIMIT:
                            # Бягучы буфер перапоўніцца → адпраўляем яго
                            await _flush_group_buffer()
                        group_buffer = (group_buffer + " " + ready).strip() if group_buffer else ready

        llm_end_ts = time.time()
        llm_total_ms = (llm_end_ts - gen_start) * 1000
        await send_perf(
            "llm_stream_end",
            "📡 LLM стрым скончыўся",
            detail=f"Агульна: {llm_total_ms:.0f} мс | "
                   f"Токенаў: {total_llm_tokens} | "
                   f"Тэкст: {len(text_buffer)} сімв.",
            duration_ms=round(llm_total_ms),
        )

        # ── Рэшткі пасля канца стрыму LLM ──
        leftover = sentence_buffer.strip()
        if leftover:
            group_buffer = (group_buffer + " " + leftover).strip() if group_buffer else leftover

        # Адпраўляем усё што засталося
        await _flush_group_buffer()

        # Wait for all TTS to finish
        await tts_sentence_queue.put(None)  # Sentinel
        await worker_task
    finally:
        if not worker_task.done():
            worker_task.cancel()

    total_ms = (time.time() - start_ts) * 1000
    await send_perf(
        "llm_complete",
        "🏁 Пайплайн Simple Voice завершаны",
        detail=f"Агульны час: {total_ms:.0f} мс | LLM: {(llm_end_ts - gen_start)*1000:.0f} мс | Тэкст: {len(text_buffer)} сімв.",
        duration_ms=round(total_ms),
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
        total_send_ms = 0
        max_send_ms = 0
        total_wait_ms = 0
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
                await _send_audio_chunk(websocket, chunk, chunk_count)
                send_ms = (time.time() - t0) * 1000
                total_send_ms += send_ms
                if send_ms > max_send_ms:
                    max_send_ms = send_ms

                if config.TTS_MODE == "local":
                    samples = len(chunk) // 4
                    info = f" | {samples} samples ({samples/LOCAL_SAMPLE_RATE*1000:.0f} ms audio)"
                else:
                    info = ""

                if not first_chunk_sent:
                    first_chunk_sent = True
                    log.info(f"[VOICE·TIMING] 📤 audio_sender: FIRST chunk sent! "
                             f"queue_wait={wait_ms:.1f} ms | ws_send={send_ms:.1f} ms{info}")
                elif chunk_count <= 5 or send_ms > 10:
                    log.info(f"[VOICE·TIMING] audio_sender #{chunk_count}: "
                             f"wait={wait_ms:.1f} ms | send={send_ms:.1f} ms{info}")

                audio_queue.task_done()
        except Exception as e:
            log.error(f"Audio sender error: {e}")
        finally:
            total_ms = (time.time() - t_sender_start) * 1000
            avg_send = total_send_ms / chunk_count if chunk_count else 0
            log.info(f"[VOICE·TIMING] audio_sender finished: {chunk_count} chunks | "
                     f"total={total_ms:.0f} ms | send_avg={avg_send:.1f} ms | "
                     f"send_max={max_send_ms:.1f} ms | wait_total={total_wait_ms:.0f} ms")

    sender_task = asyncio.create_task(audio_sender())

    async def process_voice_message(audio_data: bytes):
        """Апрацоўка аўдыя паведамлення і адпраўка стрымінгавага адказу."""
        try:
            start_ts = time.time()
            step_ts = start_ts  # for delta tracking
            log.info(f"[VOICE·TIMING] ══════════════════════════════════════")
            log.info(f"[VOICE·TIMING] ▶ Voice pipeline START | audio={len(audio_data)} bytes")

            # Events that are always shown in client perf panel (summaries)
            _ALWAYS_SHOW_EVENTS = {
                "tts_complete", "llm_complete", "llm_stream_end", "pipeline_complete",
            }
            _perf_first_audio_sent = False

            async def send_perf(event: str, label: str, detail: str = "", duration_ms: int = 0):
                """Send a structured perf log event to client.
                After first audio chunk, only summary events go to client UI.
                All events always go to server log.
                """
                nonlocal step_ts, _perf_first_audio_sent
                now = datetime.now(timezone.utc)
                elapsed = round((time.time() - start_ts) * 1000)
                delta = round((time.time() - step_ts) * 1000)
                step_ts = time.time()
                msg = {
                    "type": "perf_log",
                    "event": event,
                    "label": label,
                    "detail": detail,
                    "timestamp": now.isoformat(),
                    "elapsed_ms": elapsed,
                    "delta_ms": delta,
                    "duration_ms": duration_ms,
                }
                log.info(f"[Perf] {label} | {detail} | elapsed={elapsed}ms | Δ={delta}ms")

                # Track when first audio reaches the queue
                if event == "tts_first_chunk":
                    _perf_first_audio_sent = True

                # Send to client: always before first audio, after — only summaries
                show_to_client = (not _perf_first_audio_sent
                                  or event in _ALWAYS_SHOW_EVENTS
                                  or event == "tts_first_chunk")

                if config.SIMPLE_VOICE_DEBUG_TIMESTAMPS and show_to_client:
                    try:
                        await websocket.send_json(msg)
                    except Exception:
                        pass

            # ── Step 1: Audio received ──
            is_wav = audio_data[:4] == b'RIFF'
            await send_perf(
                "audio_received",
                "📥 Аўдыё атрымана серверам",
                detail=f"Памер: {len(audio_data)} байт | Фармат: {'WAV' if is_wav else 'PCM+header'}",
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

            total_ms = (time.time() - start_ts) * 1000
            await send_perf(
                "pipeline_complete",
                "🏁 Пайплайн завершаны",
                detail=f"Агульны час: {total_ms:.0f} мс",
                duration_ms=round(total_ms),
            )
            log.info(f"[VOICE·TIMING] ◼ Voice pipeline END | total={total_ms:.0f} ms")
            log.info(f"[VOICE·TIMING] ══════════════════════════════════════")

        except Exception as e:
            log.exception(f"Error in process_voice_message: {e}")
            try:
                await websocket.send_json({"type": "error", "message": str(e)})
            except Exception:
                pass

    # ── Helper: check for END\0 trailer (8 bytes at end of binary) ──
    _END_MARKER = b'END\x00'

    def _extract_end_marker(raw: bytes):
        """Check if binary data ends with 8-byte END\\0 trailer.
        Returns (audio_bytes, client_ts_low32) or (None, None) if no marker.
        """
        if len(raw) >= 52 and raw[-8:-4] == _END_MARKER:  # 44 WAV header + at least some data + 8 trailer
            client_ts = struct.unpack_from('<I', raw, len(raw) - 4)[0]
            return bytes(raw[:-8]), client_ts
        return None, None

    def _start_processing(audio_bytes: bytes):
        """Start voice processing task from audio bytes."""
        nonlocal audio_accumulator
        if audio_bytes[:4] == b'RIFF':
            full_wav = audio_bytes
        else:
            full_wav = _create_wav_header(len(audio_bytes)) + audio_bytes

        # Cancel previous task if still running
        if user_id in active_voice_tasks and not active_voice_tasks[user_id].done():
            active_voice_tasks[user_id].cancel()

        task = asyncio.create_task(process_voice_message(full_wav))
        active_voice_tasks[user_id] = task
        audio_accumulator = bytearray()

    # ── Main receive loop ──
    try:
        while True:
            data = await websocket.receive()

            if data.get("type") == "websocket.disconnect":
                log.info(f"WebSocket disconnect received for user {user_id}")
                break

            if "bytes" in data:
                raw = data["bytes"]
                # New protocol: WAV + END\0 trailer in single binary message
                audio_data, client_ts = _extract_end_marker(raw)
                if audio_data is not None:
                    log.info(
                        f"Received combined WAV+END ({len(audio_data)} bytes audio). "
                        f"Starting processing immediately..."
                    )
                    _start_processing(audio_data)
                else:
                    # Old protocol: accumulate chunks, wait for end_audio JSON
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
