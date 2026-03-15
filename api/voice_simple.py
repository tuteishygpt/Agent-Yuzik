# api/voice_simple.py
"""
Simple Voice Agent handler: direct Gemini LLM → TTS streaming pipeline.

Receives user audio, streams text from Gemini, splits into sentences,
and dispatches to TTS worker for streaming audio generation.
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Awaitable

from fastapi import WebSocket
from google.genai import types

import config
from api.deps import get_genai_client
from api.teacher_mode.service import controller as teacher_controller
from api.voice_history import get_voice_history
from api.voice_perf import PerfLogger
from api.voice_utils import LOCAL_SAMPLE_RATE, compress_wav_to_mp3
from tools.text_to_speech_tool import stream_speech, stream_speech_multi

# Local ASR (imported inside handle_simple_voice if needed)

log = logging.getLogger("app.voice")

# Regex for detecting sentence boundaries
_SENTENCE_END_RE = re.compile(r'[.!?…\n]+[\s»")\]]+')

# Max characters to group into a single TTS chunk (after the first segment)
# Паменшана з 250 да 190, каб TTS хутчэй атрымліваў новыя сказы і не чакаў доўга.
_GROUP_LIMIT = 190


# ── Timestamp helper ──────────────────────────────────────────────────

def _ts() -> str:
    """Return current local time as HH:MM:SS.mmm string for log prefixes."""
    now = datetime.now()
    return now.strftime("%H:%M:%S.") + f"{now.microsecond // 1000:03d}"


def _step(tag: str, msg: str, start_ts: float | None = None) -> str:
    """Format a structured step log line with optional elapsed time."""
    elapsed = f"  [+{(time.time() - start_ts)*1000:.0f}ms]" if start_ts is not None else ""
    return f"[{_ts()}] [{tag}]{elapsed} {msg}"


# ── TTS Worker ────────────────────────────────────────────────────────

class TTSWorker:
    """Consumes text sentences from a queue and streams TTS audio to audio_queue."""

    def __init__(
        self,
        audio_queue: asyncio.Queue,
        perf: PerfLogger,
        start_ts: float,
    ):
        self._audio_queue = audio_queue
        self._perf = perf
        self._start_ts = start_ts

        self._sentence_queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._cancel_event = threading.Event()

        # State
        self.sent_first_audio_chunk = False
        self._first_dispatch_ts: float | None = None
        self.llm_first_token_ts: float | None = None

    @property
    def sentence_queue(self) -> asyncio.Queue:
        return self._sentence_queue

    def start(self) -> asyncio.Task:
        log.info(_step("TTS·WORKER", "▶ Worker task created and started", self._start_ts))
        self._task = asyncio.create_task(self._run())
        return self._task

    async def stop(self):
        """Signal the worker to stop and wait for it to finish."""
        log.info(_step("TTS·WORKER", "⏹ Sending sentinel (None) to sentence_queue", self._start_ts))
        await self._sentence_queue.put(None)  # Sentinel
        if self._task:
            await self._task
        log.info(_step("TTS·WORKER", "✅ Worker task finished", self._start_ts))

    def cancel(self):
        self._cancel_event.set()
        if self._task and not self._task.done():
            log.info(_step("TTS·WORKER", "❌ Worker task cancelled (cancel_event set)", self._start_ts))
            self._task.cancel()

    async def dispatch(self, text: str):
        """Send text to the TTS queue with logging."""
        if self._first_dispatch_ts is None:
            self._first_dispatch_ts = time.time()

        q_size = self._sentence_queue.qsize()
        log.info(_step(
            "TTS·DISPATCH",
            f"✂️  → sentence_queue (qsize={q_size}) | {len(text)} chars: «{text[:80]}»",
            self._start_ts,
        ))
        await self._perf(
            "tts_dispatch",
            "✂️ Тэкст → чарга TTS",
            detail=f"({len(text)} сімв.): {text[:120]} | "
                   f"Ад старту: {(time.time()-self._start_ts)*1000:.0f} мс | "
                   f"q={q_size}",
        )
        await self._sentence_queue.put(text)
        log.info(_step(
            "TTS·DISPATCH",
            f"   put() done → qsize now={self._sentence_queue.qsize()}",
            self._start_ts,
        ))

    # ── Internal worker loop ──

    async def _run(self):
        """Consume sentences via stream_speech_multi — ONE continuous audio stream.

        Instead of calling stream_speech() per sentence (each creating a new
        _chunker with its own initial buffer delay), we pass the entire
        sentence_queue to stream_speech_multi which processes ALL sentences
        through a SINGLE _chunker — eliminating gaps between sentences.
        """
        tts_gen_start = None
        tts_chunk_count = 0
        tts_total_audio_samples = 0

        log.info(_step("TTS·WORKER", "⚙️  _run() loop started (multi-sentence mode)", self._start_ts))

        try:
            tts_gen_start = time.time()

            log.info(_step(
                "TTS·GEN",
                f"🔊 stream_speech_multi() starting | mode={config.TTS_MODE}",
                self._start_ts,
            ))
            await self._perf(
                "tts_start",
                "🔊 Пачатак TTS генерацыі (multi)",
                detail=f"Рэжым: {config.TTS_MODE} | "
                       f"Ад старту: {(time.time()-self._start_ts)*1000:.0f} мс",
                duration_ms=round((time.time() - self._start_ts) * 1000),
            )

            async for audio_chunk in stream_speech_multi(self._sentence_queue, cancel_event=self._cancel_event):
                tts_chunk_count += 1

                chunk_samples = len(audio_chunk) // 4 if config.TTS_MODE == "local" else 0
                tts_total_audio_samples += chunk_samples
                chunk_audio_ms = (
                    chunk_samples / LOCAL_SAMPLE_RATE * 1000
                    if chunk_samples > 0 else 0
                )

                if not self.sent_first_audio_chunk:
                    pipeline_ms = (time.time() - self._start_ts) * 1000
                    tts_ms = (time.time() - tts_gen_start) * 1000
                    llm_to_tts_ms = (
                        (tts_gen_start - self.llm_first_token_ts) * 1000
                        if self.llm_first_token_ts else 0
                    )
                    chunk_info = ""
                    if config.TTS_MODE == "local":
                        chunk_info = (
                            f" | chunk={chunk_samples} samples "
                            f"({chunk_audio_ms:.0f}мс аўдыё)"
                        )
                    log.info(_step(
                        "TTS·GEN",
                        f"🎵 FIRST audio chunk → audio_queue | "
                        f"pipeline={pipeline_ms:.0f}ms | "
                        f"tts={tts_ms:.0f}ms | "
                        f"llm→tts={llm_to_tts_ms:.0f}ms{chunk_info}",
                        self._start_ts,
                    ))
                    await self._perf(
                        "tts_first_chunk",
                        "🔊 Першы аўдыя чанк TTS → чарга",
                        detail=f"🏁 Пайплайн: {pipeline_ms:.0f} мс | "
                               f"TTS: {tts_ms:.0f} мс | "
                               f"LLM→TTS: {llm_to_tts_ms:.0f} мс{chunk_info}",
                        duration_ms=round(pipeline_ms),
                    )
                    self.sent_first_audio_chunk = True

                t_put = time.time()
                aq_size_before = self._audio_queue.qsize()
                await self._audio_queue.put(audio_chunk)
                put_ms = (time.time() - t_put) * 1000
                aq_size_after = self._audio_queue.qsize()

                log.debug(_step(
                    "TTS·QUEUE",
                    f"   chunk #{tts_chunk_count} → audio_queue "
                    f"(qsize {aq_size_before}→{aq_size_after}) | "
                    f"put={put_ms:.1f}ms | {len(audio_chunk)}B ({chunk_audio_ms:.0f}ms)",
                    self._start_ts,
                ))

                if put_ms > 5:
                    log.warning(_step(
                        "TTS·QUEUE",
                        f"⚠️  audio_queue.put SLOW: {put_ms:.1f}ms | "
                        f"chunk #{tts_chunk_count} | qsize={aq_size_after}",
                        self._start_ts,
                    ))

        except Exception as e:
            log.error(_step("TTS·WORKER", f"💥 EXCEPTION in _run(): {e}"), exc_info=True)

        finally:
            if tts_gen_start:
                total_tts_ms = (time.time() - tts_gen_start) * 1000
                total_audio_ms = (
                    tts_total_audio_samples / LOCAL_SAMPLE_RATE * 1000
                    if config.TTS_MODE == "local" else 0
                )
                rtf = total_tts_ms / total_audio_ms if total_audio_ms > 0 else 0
                log.info(_step(
                    "TTS·WORKER",
                    f"📊 SUMMARY | chunks={tts_chunk_count} | "
                    f"tts_time={total_tts_ms:.0f}ms | "
                    f"audio_generated={total_audio_ms:.0f}ms | "
                    f"RTF={rtf:.3f}x",
                    self._start_ts,
                ))
                await self._perf(
                    "tts_complete",
                    "✅ TTS генерацыя завершана",
                    detail=f"Час TTS: {total_tts_ms:.0f} мс | "
                           f"Чанкаў: {tts_chunk_count} | "
                           f"Аўдыё: {total_audio_ms:.0f} мс | "
                           f"RTF: {rtf:.2f}x",
                    duration_ms=round(total_tts_ms),
                )
            log.info(_step("TTS·WORKER", "🏁 _run() finally block done", self._start_ts))


# ── Main handler ─────────────────────────────────────────────────────

async def handle_simple_voice(
    audio_data: bytes,
    websocket: WebSocket,
    audio_queue: asyncio.Queue,
    perf: PerfLogger,
    user_id: str = "voice_user",
    ws_session_id: str = "",
):
    """Process audio via Simple Voice Agent (direct Gemini → TTS streaming)."""
    session_id = ws_session_id
    start_ts = perf.start_ts
    gen_start = time.time()

    log.info(_step("VOICE·PIPELINE", f"▶ handle_simple_voice() START | audio={len(audio_data)}B | user={user_id}"))
    log.info(_step("VOICE·PIPELINE", f"   model={config.SIMPLE_VOICE_MODEL} | tts_mode={config.TTS_MODE}", start_ts))

    await perf(
        "llm_start",
        "🤖 Запуск LLM мадэлі",
        detail=f"Мадэль: {config.SIMPLE_VOICE_MODEL} | аўдыё: {len(audio_data)} байт",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    # ── Teacher mode extension ──
    teacher_state = teacher_controller.get_state(session_id=session_id, user_id=user_id)
    if teacher_state:
        log.info(_step("VOICE·TEACHER", f"📚 Teacher mode active | lesson={teacher_state.lesson_id}", start_ts))
        await perf(
            "teacher_mode",
            "📚 Рэжым настаўніка актыўны",
            detail=f"lesson_id={teacher_state.lesson_id} | step={teacher_state.current_step_id}",
            duration_ms=round((time.time() - start_ts) * 1000),
        )

        tts = TTSWorker(audio_queue, perf, start_ts)
        tts.start()
        try:
            teacher_transcript = ""
            if config.LOCAL_ASR:
                from api import local_asr

                if not local_asr.is_ready():
                    log.warning(_step("VOICE?ASR", "?? LOCAL_ASR=True but model not loaded, loading now?", start_ts))
                    await asyncio.to_thread(local_asr.load_asr_model)

                teacher_transcript = await asyncio.to_thread(local_asr.transcribe_wav_bytes, audio_data)
                log.info(_step("VOICE·TEACHER", f"📝 Local transcript: «{teacher_transcript[:120]}»", start_ts))
            else:
                log.info(_step("VOICE·TEACHER", "📝 LOCAL_ASR disabled, teacher mode will use remote transcription", start_ts))

            outcome = await teacher_controller.process_audio_turn(
                session_id=session_id,
                user_id=user_id,
                audio_data=audio_data,
                transcript=teacher_transcript,
            )

            log.info(
                _step(
                    "VOICE·TEACHER",
                    f"📝 Teacher transcript result: «{outcome.transcript[:120]}» | normalized=«{outcome.normalized_transcript[:120]}»",
                    start_ts,
                )
            )

            if outcome.transcript:
                await websocket.send_json({"type": "transcription", "text": outcome.transcript})

            await websocket.send_json({
                "type": "response",
                "text": outcome.reply_text,
                "mode": "teacher",
                "teacher_action": outcome.teacher_action.value,
                "step_id": outcome.step_id,
                "fallback_reason": outcome.fallback_reason,
            })

            await tts.dispatch(outcome.reply_text)
            await tts.stop()
            return
        finally:
            tts.cancel()

    client = get_genai_client()

    # ── Build multi-turn contents with voice history ──
    log.info(_step("VOICE·HISTORY", "📜 Loading voice history…", start_ts))
    voice_history = get_voice_history(user_id)
    history_contents = voice_history.to_gemini_contents()
    log.info(_step(
        "VOICE·HISTORY",
        f"   turns={voice_history.turn_count} | contents={len(history_contents)}",
        start_ts,
    ))
    await perf(
        "history_loaded",
        "📜 Гісторыя загружана",
        detail=f"Тураў: {voice_history.turn_count} | "
               f"Элементаў кантэксту: {len(history_contents)} | "
               f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    # ── Prepare user content: local ASR (text) or compressed audio ──
    user_transcription: str | None = None  # filled when LOCAL_ASR is on

    if config.LOCAL_ASR:
        from api import local_asr
        # ── Local ASR: transcribe audio → send TEXT to Gemini ──
        if not local_asr.is_ready():
            log.warning(_step("VOICE·ASR", "⚠️ LOCAL_ASR=True but model not loaded, loading now…", start_ts))
            await asyncio.to_thread(local_asr.load_asr_model)

        log.info(_step("VOICE·ASR", f"🎙️ Local ASR transcription start | audio={len(audio_data)}B", start_ts))
        t_asr = time.time()
        user_transcription = await asyncio.to_thread(local_asr.transcribe_wav_bytes, audio_data)
        asr_ms = (time.time() - t_asr) * 1000
        log.info(_step(
            "VOICE·ASR",
            f"   ✅ Transcription: «{user_transcription[:120]}» | {asr_ms:.0f}ms",
            start_ts,
        ))
        await perf(
            "local_asr_done",
            "🎙️ Лакальнае распазнаванне голасу",
            detail=f"Тэкст: «{user_transcription[:100]}» | "
                   f"Час: {asr_ms:.0f} мс | "
                   f"Мадэль: {config.LOCAL_ASR_MODEL}",
            duration_ms=round(asr_ms),
        )

        # Send transcription to client UI so they see what was recognized
        await websocket.send_json({
            "type": "transcription",
            "text": user_transcription,
        })

        current_user_content = types.Content(
            role="user",
            parts=[types.Part(text=user_transcription)],
        )
    else:
        # ── Compress WAV → MP3 (16kHz, 64k) to reduce Gemini upload size ──
        log.info(_step("VOICE·COMPRESS", f"🗜️  Compressing WAV→MP3 | input={len(audio_data)}B", start_ts))
        t_compress = time.time()
        mp3_data = await asyncio.to_thread(compress_wav_to_mp3, audio_data)
        compress_ms = (time.time() - t_compress) * 1000
        ratio = len(audio_data) / len(mp3_data) if mp3_data else 0
        log.info(_step(
            "VOICE·COMPRESS",
            f"   ✅ WAV→MP3: {len(audio_data)}B → {len(mp3_data)}B "
            f"(×{ratio:.1f}) | {compress_ms:.0f}ms",
            start_ts,
        ))
        await perf(
            "audio_compressed",
            "🗜️ Аўдыё сціснута WAV→MP3",
            detail=f"{len(audio_data)}B → {len(mp3_data)}B (×{ratio:.1f} сцісканне) | "
                   f"Час: {compress_ms:.0f} мс",
            duration_ms=round(compress_ms),
        )

        # Current user turn with compressed audio
        current_user_content = types.Content(
            role="user",
            parts=[
                types.Part(
                    inline_data=types.Blob(
                        mime_type="audio/mp3",
                        data=mp3_data,
                    )
                )
            ],
        )

    all_contents = history_contents + [current_user_content]

    if history_contents:
        log.info(_step(
            "VOICE·HISTORY",
            f"Including {voice_history.turn_count} previous turns in Gemini context",
            start_ts,
        ))

    # ── Gemini API call ──
    log.info(_step("VOICE·LLM", f"📡 generate_content_stream() → API call start…", start_ts))
    t_api_call = time.time()
    response_stream = await client.aio.models.generate_content_stream(
        model=config.SIMPLE_VOICE_MODEL,
        contents=all_contents,
        config=types.GenerateContentConfig(
            system_instruction=config.SIMPLE_VOICE_SYSTEM_PROMPT,
            temperature=0.7,
        ),
    )
    api_call_ms = (time.time() - t_api_call) * 1000
    log.info(_step("VOICE·LLM", f"   ✅ Stream object received in {api_call_ms:.0f}ms", start_ts))

    await perf(
        "llm_stream_created",
        "📡 LLM стрым створаны",
        detail=f"API выклік: {api_call_ms:.0f} мс | "
               f"Ад старту: {(time.time() - start_ts)*1000:.0f} мс",
        duration_ms=round(api_call_ms),
    )

    # ── TTS Worker ──
    log.info(_step("VOICE·PIPELINE", "⚙️  Creating TTSWorker…", start_ts))
    tts = TTSWorker(audio_queue, perf, start_ts)
    worker_task = tts.start()
    await perf(
        "tts_worker_start",
        "⚙️ TTS Worker запушчаны",
        detail=f"Рэжым: {config.TTS_MODE} | "
               f"GROUP_LIMIT: {_GROUP_LIMIT} сімв. | "
               f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    # ── LLM stream processing with sentence grouping ──
    text_buffer = ""
    sentence_buffer = ""
    group_buffer = ""
    first_token = True
    first_sentence_ready = False
    first_tts_dispatched = False
    total_llm_tokens = 0
    llm_end_ts = gen_start  # fallback

    ws_send_count = 0
    dispatch_count = 0
    _ws_last_sent_len = 0  # throttle: track last sent text length

    log.info(_step("VOICE·LLM", "🔄 Starting async iteration of LLM response stream…", start_ts))

    try:
        t_first_iter = time.time()
        async for chunk in response_stream:
            from fastapi.websockets import WebSocketState
            if websocket.client_state != WebSocketState.CONNECTED:
                log.warning(_step("VOICE·LLM", "⚠️ WebSocket disconnected, aborting pipeline", start_ts))
                break

            if not chunk.text:
                continue

            total_llm_tokens += 1

            if first_token:
                tts.llm_first_token_ts = time.time()
                ttft_ms = (tts.llm_first_token_ts - gen_start) * 1000
                iter_wait_ms = (tts.llm_first_token_ts - t_first_iter) * 1000
                log.info(_step(
                    "VOICE·LLM",
                    f"✍️  FIRST TOKEN received | TTFT={ttft_ms:.0f}ms | "
                    f"iter_wait={iter_wait_ms:.0f}ms | text=«{chunk.text[:60]}»",
                    start_ts,
                ))
                await perf(
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

            # ── Send incremental text to client UI (throttled: every 8 tokens) ──
            # Sending on every token blocks the event loop with hundreds of awaits,
            # delaying sentence dispatch to TTS. 8-token batching keeps UI smooth
            # while cutting await overhead ~8x.
            if total_llm_tokens % 8 == 1:
                ws_send_count += 1
                t_ws = time.time()
                await websocket.send_json({
                    "type": "response",
                    "text": text_buffer,
                })
                _ws_last_sent_len = len(text_buffer)
                ws_ms = (time.time() - t_ws) * 1000
                if ws_ms > 10:
                    log.warning(_step(
                        "VOICE·WS",
                        f"⚠️  websocket.send_json SLOW: {ws_ms:.1f}ms (token #{total_llm_tokens})",
                        start_ts,
                    ))

            # ── Two modes: first sentence → immediately, rest → group ──
            matches = list(_SENTENCE_END_RE.finditer(sentence_buffer))
            if not matches:
                continue

            last_match = matches[-1]
            split_idx = last_match.end()
            ready = sentence_buffer[:split_idx].strip()
            sentence_buffer = sentence_buffer[split_idx:]

            if not ready:
                continue

            if not first_tts_dispatched:
                # Accumulate until we have enough for first segment
                group_buffer = f"{group_buffer} {ready}".strip() if group_buffer else ready
                log.debug(_step(
                    "VOICE·SPLIT",
                    f"🗄  Accumulate first segment | "
                    f"group_buffer={len(group_buffer)} chars | "
                    f"limit={config.TTS_FIRST_SEGMENT_LIMIT}",
                    start_ts,
                ))
                if len(group_buffer) >= config.TTS_FIRST_SEGMENT_LIMIT:
                    if not first_sentence_ready:
                        first_sentence_ready = True
                        sentence_ready_ms = (time.time() - gen_start) * 1000
                        log.info(_step(
                            "VOICE·SPLIT",
                            f"📝 FIRST SEGMENT ready | {len(group_buffer)} chars | "
                            f"time_to_first_seg={sentence_ready_ms:.0f}ms | "
                            f"tokens_so_far={total_llm_tokens} | "
                            f"text=«{group_buffer[:80]}»",
                            start_ts,
                        ))
                        await perf(
                            "llm_first_sentence",
                            "📝 Першы сказ гатовы для TTS",
                            detail=f"Час: {sentence_ready_ms:.0f} мс | "
                                   f"{len(group_buffer)} сімв. | "
                                   f"LLM токенаў: {total_llm_tokens} | "
                                   f"Тэкст: «{group_buffer[:80]}»",
                            duration_ms=round(sentence_ready_ms),
                        )
                    dispatch_count += 1
                    log.info(_step(
                        "VOICE·SPLIT",
                        f"📤 dispatch #{dispatch_count} (first) | {len(group_buffer)} chars",
                        start_ts,
                    ))
                    await tts.dispatch(group_buffer)
                    group_buffer = ""
                    first_tts_dispatched = True
            else:
                # Group subsequent sentences into larger chunks
                if group_buffer and len(group_buffer) + 1 + len(ready) > _GROUP_LIMIT:
                    if group_buffer.strip():
                        dispatch_count += 1
                        log.info(_step(
                            "VOICE·SPLIT",
                            f"📤 dispatch #{dispatch_count} (group flush) | "
                            f"{len(group_buffer)} chars | token #{total_llm_tokens}",
                            start_ts,
                        ))
                        await perf(
                            "split_group_flush",
                            f"📤 Групавы dispatch #{dispatch_count}",
                            detail=f"{len(group_buffer.strip())} сімв. | "
                                   f"LLM токен #{total_llm_tokens} | "
                                   f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс | "
                                   f"Тэкст: «{group_buffer.strip()[:60]}»",
                            duration_ms=round((time.time() - start_ts) * 1000),
                        )
                        await tts.dispatch(group_buffer.strip())
                        group_buffer = ""
                group_buffer = f"{group_buffer} {ready}".strip() if group_buffer else ready

        # ── LLM stream finished ──
        llm_end_ts = time.time()
        llm_total_ms = (llm_end_ts - gen_start) * 1000
        log.info(_step(
            "VOICE·LLM",
            f"⏹ LLM stream ENDED | tokens={total_llm_tokens} | "
            f"llm_time={llm_total_ms:.0f}ms | "
            f"text_len={len(text_buffer)} chars | "
            f"ws_sends={ws_send_count} | dispatches={dispatch_count}",
            start_ts,
        ))
        await perf(
            "llm_stream_end",
            "📡 LLM стрым скончыўся",
            detail=f"Агульна: {llm_total_ms:.0f} мс | "
                   f"Токенаў: {total_llm_tokens} | "
                   f"Тэкст: {len(text_buffer)} сімв.",
            duration_ms=round(llm_total_ms),
        )

        # ── Final UI text flush (throttling may have skipped last tokens) ──
        if text_buffer and len(text_buffer) > _ws_last_sent_len:
            ws_send_count += 1
            await websocket.send_json({"type": "response", "text": text_buffer})

        # ── Flush remaining text ──
        leftover = sentence_buffer.strip()
        if leftover:
            group_buffer = f"{group_buffer} {leftover}".strip() if group_buffer else leftover
            log.info(_step(
                "VOICE·SPLIT",
                f"🗑  Flushing leftover sentence_buffer: {len(leftover)} chars",
                start_ts,
            ))

        if group_buffer.strip():
            dispatch_count += 1
            log.info(_step(
                "VOICE·SPLIT",
                f"📤 dispatch #{dispatch_count} (final flush) | {len(group_buffer.strip())} chars",
                start_ts,
            ))
            await perf(
                "split_final_flush",
                f"📤 Фінальны dispatch #{dispatch_count}",
                detail=f"{len(group_buffer.strip())} сімв. | "
                       f"Усяго dispatches: {dispatch_count} | "
                       f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс | "
                       f"Тэкст: «{group_buffer.strip()[:60]}»",
                duration_ms=round((time.time() - start_ts) * 1000),
            )
            await tts.dispatch(group_buffer.strip())

        log.info(_step("VOICE·PIPELINE", f"⏳ Waiting for TTS worker to finish…", start_ts))
        await tts.stop()
        log.info(_step("VOICE·PIPELINE", f"✅ TTS worker stopped", start_ts))
        await perf(
            "tts_worker_done",
            "✅ TTS Worker завершаны",
            detail=f"Dispatches за сесію: {dispatch_count} | "
                   f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
            duration_ms=round((time.time() - start_ts) * 1000),
        )

    finally:
        tts.cancel()

    # ── Save turn to voice history ──
    if text_buffer.strip():
        user_text = user_transcription if user_transcription else "[галасавое паведамленне]"
        assistant_text = text_buffer.strip()

        voice_history.add_turn(
            user_text=user_text,
            assistant_text=assistant_text,
        )

        try:
            with open("dialogues.txt", "a", encoding="utf-8") as f:
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{timestamp}] USER ({user_id}): {user_text}\n")
                f.write(f"[{timestamp}] BOT: {assistant_text}\n---\n")
        except Exception as e:
            log.error(f"Памылка пры захаванні дыялогу ў файл: {e}")

        log.info(_step(
            "VOICE·HISTORY",
            f"💾 Saved turn to history | "
            f"assistant={len(text_buffer)} chars | "
            f"total_turns={voice_history.turn_count}",
            start_ts,
        ))
        await perf(
            "history_saved",
            "💾 Гісторыя захавана",
            detail=f"Адказ: {len(text_buffer)} сімв. | "
            f"Усяго тураў: {voice_history.turn_count} | "
            f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
            duration_ms=round((time.time() - start_ts) * 1000),
        )

    total_ms = (time.time() - start_ts) * 1000
    log.info(_step(
        "VOICE·PIPELINE",
        f"🏁 handle_simple_voice() DONE | "
        f"total={total_ms:.0f}ms | "
        f"llm={((llm_end_ts - gen_start)*1000):.0f}ms | "
        f"text={len(text_buffer)} chars | "
        f"dispatches={dispatch_count} | "
        f"ws_sends={ws_send_count}",
        start_ts,
    ))
    await perf(
        "llm_complete",
        "🏁 Пайплайн Simple Voice завершаны",
        detail=f"Агульны час: {total_ms:.0f} мс | "
               f"LLM: {(llm_end_ts - gen_start)*1000:.0f} мс | "
               f"Тэкст: {len(text_buffer)} сімв. | "
               f"Гісторыя: {voice_history.turn_count} тураў",
        duration_ms=round(total_ms),
    )
