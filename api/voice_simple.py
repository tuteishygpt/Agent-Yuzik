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
from fastapi import WebSocket
from fastapi.websockets import WebSocketState
from google.genai import types

import config
from api.deps import get_genai_client
from api.voice_history import get_voice_history
from api.voice_perf import PerfLogger
from api.voice_utils import LOCAL_SAMPLE_RATE
from tools.text_to_speech_tool import stream_speech_multi

log = logging.getLogger("app.voice")

# Regex for detecting sentence boundaries
_SENTENCE_END_RE = re.compile(r'[.!?…\n]+[\s»")\]]+')

# Max characters to group into a single TTS chunk (after the first segment)
_GROUP_LIMIT = 190
_TTS_IDLE_STOP_TIMEOUT_S = 2.0
_TTS_ACTIVE_STOP_TIMEOUT_S = 30.0


# ── Timestamp helper ──────────────────────────────────────────────────

def _ts() -> str:
    """Return current local time as HH:MM:SS.mmm string for log prefixes."""
    now = datetime.now()
    return now.strftime("%H:%M:%S.") + f"{now.microsecond // 1000:03d}"


def _step(tag: str, msg: str, start_ts: float | None = None) -> str:
    """Format a structured step log line with optional elapsed time."""
    elapsed = f"  [+{(time.time() - start_ts)*1000:.0f}ms]" if start_ts is not None else ""
    return f"[{_ts()}] [{tag}]{elapsed} {msg}"


async def _transcribe_audio_with_model(audio_data: bytes) -> str:
    """Fallback transcription when local ASR is disabled."""
    client = get_genai_client()
    prompt = (
        "Transcribe this short Belarusian user audio. "
        "Return only the recognized words, no explanations, no quotes, no markdown. "
        "If speech is unclear, return an empty string."
    )
    response = await client.aio.models.generate_content(
        model=config.SIMPLE_VOICE_MODEL,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part(text=prompt),
                    types.Part(inline_data=types.Blob(mime_type="audio/wav", data=audio_data)),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            temperature=0.0,
        ),
    )
    return (response.text or "").strip().strip('"')


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
        self._llm_first_token_ts: float | None = None

    @property
    def sentence_queue(self) -> asyncio.Queue:
        return self._sentence_queue

    def set_llm_first_token_ts(self, ts: float) -> None:
        self._llm_first_token_ts = ts

    def start(self) -> asyncio.Task:
        log.info(_step("TTS·WORKER", "▶ Worker task created and started", self._start_ts))
        self._task = asyncio.create_task(self._run())
        return self._task

    def cancel(self):
        self._cancel_event.set()
        if self._task and not self._task.done():
            log.info(_step("TTS·WORKER", "❌ Worker task cancelled (cancel_event set)", self._start_ts))
            self._task.cancel()

    async def stop(self):
        """Signal the worker to stop and bound the wait for external TTS backends."""
        log.info(_step("TTS·WORKER", "⏹ Sending sentinel (None) to sentence_queue", self._start_ts))
        await self._sentence_queue.put(None)  # Sentinel
        if self._task:
            timeout_s = (
                _TTS_ACTIVE_STOP_TIMEOUT_S
                if self._first_dispatch_ts is not None
                else _TTS_IDLE_STOP_TIMEOUT_S
            )
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout_s)
            except asyncio.TimeoutError:
                log.warning(_step(
                    "TTS·WORKER",
                    f"⚠️ stop() timeout after {timeout_s:.1f}s; cancelling stuck worker",
                    self._start_ts,
                ))
                self.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    log.info(_step("TTS·WORKER", "🛑 Worker cancelled after stop timeout", self._start_ts))
        log.info(_step("TTS·WORKER", "✅ Worker task finished", self._start_ts))

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
                        (tts_gen_start - self._llm_first_token_ts) * 1000
                        if self._llm_first_token_ts else 0
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


# ── Sentence splitter ────────────────────────────────────────────────

class SentenceSplitter:
    """Accumulates LLM text tokens and yields dispatch-ready text groups.

    Handles the two-phase dispatch strategy:
      1. First segment: accumulate until TTS_FIRST_SEGMENT_LIMIT chars
      2. Subsequent segments: group sentences up to _GROUP_LIMIT chars
    """

    def __init__(self):
        self._sentence_buf = ""
        self._group_buf = ""
        self._first_dispatched = False

    @property
    def first_dispatched(self) -> bool:
        return self._first_dispatched

    def add_token(self, text: str) -> list[str]:
        """Feed a token and return a (possibly empty) list of texts to dispatch."""
        self._sentence_buf += text

        matches = list(_SENTENCE_END_RE.finditer(self._sentence_buf))
        if not matches:
            return []

        split_idx = matches[-1].end()
        ready = self._sentence_buf[:split_idx].strip()
        self._sentence_buf = self._sentence_buf[split_idx:]

        if not ready:
            return []

        if not self._first_dispatched:
            self._group_buf = f"{self._group_buf} {ready}".strip() if self._group_buf else ready
            if len(self._group_buf) < config.TTS_FIRST_SEGMENT_LIMIT:
                return []
            result = [self._group_buf]
            self._group_buf = ""
            self._first_dispatched = True
            return result

        dispatches: list[str] = []
        if self._group_buf and len(self._group_buf) + 1 + len(ready) > _GROUP_LIMIT:
            stripped = self._group_buf.strip()
            if stripped:
                dispatches.append(stripped)
            self._group_buf = ""
        self._group_buf = f"{self._group_buf} {ready}".strip() if self._group_buf else ready
        return dispatches

    def flush(self) -> str | None:
        """Return any remaining text after the LLM stream ends."""
        leftover = self._sentence_buf.strip()
        if leftover:
            self._group_buf = f"{self._group_buf} {leftover}".strip() if self._group_buf else leftover
            self._sentence_buf = ""
        final = self._group_buf.strip()
        self._group_buf = ""
        return final or None


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

    # ── Teacher mode — delegated to voice_teacher module ──
    from api.teacher_mode.service import controller as teacher_controller
    teacher_state = teacher_controller.get_state(session_id=session_id, user_id=user_id)
    if teacher_state:
        from api.voice_teacher import handle_teacher_voice
        await handle_teacher_voice(
            audio_data, websocket, audio_queue, perf,
            start_ts, session_id, user_id, teacher_state,
        )
        return

    # ── ASR + build Gemini contents ──
    voice_history = await _load_voice_history(user_id, perf, start_ts)
    user_transcription, current_user_content = await _transcribe_and_build_content(
        audio_data, websocket, perf, start_ts,
    )
    all_contents = voice_history.to_gemini_contents() + [current_user_content]

    if voice_history.turn_count:
        log.info(_step(
            "VOICE·HISTORY",
            f"Including {voice_history.turn_count} previous turns in Gemini context",
            start_ts,
        ))

    # ── Gemini streaming call ──
    response_stream = await _start_llm_stream(all_contents, perf, start_ts)

    # ── TTS Worker ──
    log.info(_step("VOICE·PIPELINE", "⚙️  Creating TTSWorker…", start_ts))
    tts = TTSWorker(audio_queue, perf, start_ts)
    tts.start()
    await perf(
        "tts_worker_start",
        "⚙️ TTS Worker запушчаны",
        detail=f"Рэжым: {config.TTS_MODE} | "
               f"GROUP_LIMIT: {_GROUP_LIMIT} сімв. | "
               f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    # ── Stream LLM → sentence split → TTS dispatch ──
    text_buffer, dispatch_count, ws_send_count, llm_end_ts = await _stream_and_dispatch(
        response_stream, websocket, tts, perf, start_ts, gen_start,
    )

    # ── Save turn to voice history ──
    await _save_voice_history(
        voice_history, user_id, user_transcription, text_buffer, perf, start_ts,
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


# ── Sub-steps of the voice pipeline ─────────────────────────────────


async def _load_voice_history(user_id: str, perf: PerfLogger, start_ts: float):
    """Load voice conversation history for this user."""
    log.info(_step("VOICE·HISTORY", "📜 Loading voice history…", start_ts))
    voice_history = get_voice_history(user_id)
    log.info(_step(
        "VOICE·HISTORY",
        f"   turns={voice_history.turn_count} | contents={len(voice_history.to_gemini_contents())}",
        start_ts,
    ))
    await perf(
        "history_loaded",
        "📜 Гісторыя загружана",
        detail=f"Тураў: {voice_history.turn_count} | "
               f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
        duration_ms=round((time.time() - start_ts) * 1000),
    )
    return voice_history


async def _transcribe_and_build_content(
    audio_data: bytes,
    websocket: WebSocket,
    perf: PerfLogger,
    start_ts: float,
) -> tuple[str | None, types.Content]:
    """Transcribe audio (local or remote ASR) and build Gemini user Content."""
    if config.LOCAL_ASR:
        return await _transcribe_local(audio_data, websocket, perf, start_ts)
    return await _transcribe_remote(audio_data, websocket, perf, start_ts)


async def _transcribe_local(
    audio_data: bytes,
    websocket: WebSocket,
    perf: PerfLogger,
    start_ts: float,
) -> tuple[str | None, types.Content]:
    """Local ASR: transcribe audio → return text Content for Gemini."""
    from api import local_asr

    if not local_asr.is_ready():
        log.warning(_step("VOICE·ASR", "⚠️ LOCAL_ASR=True but model not loaded, loading now…", start_ts))
        await asyncio.to_thread(local_asr.load_asr_model)
        if not local_asr.is_ready():
            log.error(_step(
                "VOICE·ASR",
                "LOCAL_ASR model is unavailable after load attempt; falling back to remote ASR",
                start_ts,
            ))
            return await _transcribe_remote(audio_data, websocket, perf, start_ts)

    log.info(_step("VOICE·ASR", f"🎙️ Local ASR transcription start | audio={len(audio_data)}B", start_ts))
    t_asr = time.time()
    transcription = await asyncio.to_thread(local_asr.transcribe_wav_bytes, audio_data)
    asr_ms = (time.time() - t_asr) * 1000
    log.info(_step("VOICE·ASR", f"   ✅ Transcription: «{transcription[:120]}» | {asr_ms:.0f}ms", start_ts))
    await perf(
        "local_asr_done",
        "🎙️ Лакальнае распазнаванне голасу",
        detail=f"Тэкст: «{transcription[:100]}» | "
               f"Час: {asr_ms:.0f} мс | "
               f"Мадэль: {config.LOCAL_ASR_MODEL}",
        duration_ms=round(asr_ms),
    )

    await websocket.send_json({"type": "transcription", "text": transcription})

    content = types.Content(role="user", parts=[types.Part(text=transcription)])
    return transcription, content


async def _transcribe_remote(
    audio_data: bytes,
    websocket: WebSocket,
    perf: PerfLogger,
    start_ts: float,
) -> tuple[str | None, types.Content]:
    """Remote ASR fallback: transcribe audio → return text Content for Gemini."""
    log.info(_step("VOICE·ASR", "🎙️ Remote transcription start (fallback)", start_ts))
    t_remote_asr = time.time()
    try:
        transcription = await _transcribe_audio_with_model(audio_data)
    except Exception:
        log.exception(_step("VOICE·ASR", "❌ Remote transcription failed", start_ts))
        transcription = None
    remote_asr_ms = (time.time() - t_remote_asr) * 1000

    if transcription:
        log.info(_step(
            "VOICE·ASR",
            f"   ✅ Remote transcription: «{transcription[:120]}» | {remote_asr_ms:.0f}ms",
            start_ts,
        ))
        await perf(
            "remote_asr_done",
            "🎙️ Аддаленае распазнаванне голасу",
            detail=f"Тэкст: «{transcription[:100]}» | Час: {remote_asr_ms:.0f} мс",
            duration_ms=round(remote_asr_ms),
        )
        await websocket.send_json({"type": "transcription", "text": transcription})

    content = types.Content(role="user", parts=[types.Part(text=transcription or "")])
    return transcription, content


async def _start_llm_stream(all_contents: list, perf: PerfLogger, start_ts: float):
    """Start Gemini streaming generation and return the async response stream."""
    client = get_genai_client()

    log.info(_step("VOICE·LLM", "📡 generate_content_stream() → API call start…", start_ts))
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
    return response_stream


async def _stream_and_dispatch(
    response_stream,
    websocket: WebSocket,
    tts: TTSWorker,
    perf: PerfLogger,
    start_ts: float,
    gen_start: float,
) -> tuple[str, int, int, float]:
    """Iterate the LLM stream, split into sentences, dispatch to TTS.

    Returns (text_buffer, dispatch_count, ws_send_count, llm_end_ts).
    """
    text_buffer = ""
    first_token = True
    total_llm_tokens = 0
    llm_end_ts = gen_start

    ws_send_count = 0
    dispatch_count = 0
    _ws_last_sent_len = 0

    splitter = SentenceSplitter()

    log.info(_step("VOICE·LLM", "🔄 Starting async iteration of LLM response stream…", start_ts))

    try:
        t_first_iter = time.time()
        async for chunk in response_stream:
            if websocket.client_state != WebSocketState.CONNECTED:
                log.warning(_step("VOICE·LLM", "⚠️ WebSocket disconnected, aborting pipeline", start_ts))
                break

            if not chunk.text:
                continue

            total_llm_tokens += 1

            if first_token:
                first_token_ts = time.time()
                tts.set_llm_first_token_ts(first_token_ts)
                ttft_ms = (first_token_ts - gen_start) * 1000
                iter_wait_ms = (first_token_ts - t_first_iter) * 1000
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

            # Throttled UI updates: every 8 tokens
            if total_llm_tokens % 8 == 1:
                ws_send_count += 1
                t_ws = time.time()
                await websocket.send_json({"type": "response", "text": text_buffer})
                _ws_last_sent_len = len(text_buffer)
                ws_ms = (time.time() - t_ws) * 1000
                if ws_ms > 10:
                    log.warning(_step(
                        "VOICE·WS",
                        f"⚠️  websocket.send_json SLOW: {ws_ms:.1f}ms (token #{total_llm_tokens})",
                        start_ts,
                    ))

            # ── Sentence splitting and dispatch ──
            dispatches = splitter.add_token(chunk.text)

            if dispatches and dispatch_count == 0:
                # First segment just became ready
                first_text = dispatches[0]
                sentence_ready_ms = (time.time() - gen_start) * 1000
                log.info(_step(
                    "VOICE·SPLIT",
                    f"📝 FIRST SEGMENT ready | {len(first_text)} chars | "
                    f"time_to_first_seg={sentence_ready_ms:.0f}ms | "
                    f"tokens_so_far={total_llm_tokens} | "
                    f"text=«{first_text[:80]}»",
                    start_ts,
                ))
                await perf(
                    "llm_first_sentence",
                    "📝 Першы сказ гатовы для TTS",
                    detail=f"Час: {sentence_ready_ms:.0f} мс | "
                           f"{len(first_text)} сімв. | "
                           f"LLM токенаў: {total_llm_tokens} | "
                           f"Тэкст: «{first_text[:80]}»",
                    duration_ms=round(sentence_ready_ms),
                )

            for text in dispatches:
                dispatch_count += 1
                label = "first" if dispatch_count == 1 else "group flush"
                log.info(_step(
                    "VOICE·SPLIT",
                    f"📤 dispatch #{dispatch_count} ({label}) | "
                    f"{len(text)} chars | token #{total_llm_tokens}",
                    start_ts,
                ))
                if label != "first":
                    await perf(
                        "split_group_flush",
                        f"📤 Групавы dispatch #{dispatch_count}",
                        detail=f"{len(text)} сімв. | "
                               f"LLM токен #{total_llm_tokens} | "
                               f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс | "
                               f"Тэкст: «{text[:60]}»",
                        duration_ms=round((time.time() - start_ts) * 1000),
                    )
                await tts.dispatch(text)

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

        # Final UI text flush
        if text_buffer and len(text_buffer) > _ws_last_sent_len:
            ws_send_count += 1
            await websocket.send_json({"type": "response", "text": text_buffer})

        # Flush remaining text to TTS
        final_text = splitter.flush()
        if final_text:
            dispatch_count += 1
            log.info(_step(
                "VOICE·SPLIT",
                f"📤 dispatch #{dispatch_count} (final flush) | {len(final_text)} chars",
                start_ts,
            ))
            await perf(
                "split_final_flush",
                f"📤 Фінальны dispatch #{dispatch_count}",
                detail=f"{len(final_text)} сімв. | "
                       f"Усяго dispatches: {dispatch_count} | "
                       f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс | "
                       f"Тэкст: «{final_text[:60]}»",
                duration_ms=round((time.time() - start_ts) * 1000),
            )
            await tts.dispatch(final_text)

        log.info(_step("VOICE·PIPELINE", "⏳ Waiting for TTS worker to finish…", start_ts))
        await tts.stop()
        log.info(_step("VOICE·PIPELINE", "✅ TTS worker stopped", start_ts))
        await perf(
            "tts_worker_done",
            "✅ TTS Worker завершаны",
            detail=f"Dispatches за сесію: {dispatch_count} | "
                   f"Ад старту: {(time.time()-start_ts)*1000:.0f} мс",
            duration_ms=round((time.time() - start_ts) * 1000),
        )

    finally:
        tts.cancel()

    return text_buffer, dispatch_count, ws_send_count, llm_end_ts


async def _save_voice_history(
    voice_history,
    user_id: str,
    user_transcription: str | None,
    text_buffer: str,
    perf: PerfLogger,
    start_ts: float,
) -> None:
    """Save the completed turn to voice history and dialogue log."""
    if not text_buffer.strip():
        return

    user_text = user_transcription if user_transcription else "[галасавое паведамленне]"
    assistant_text = text_buffer.strip()

    voice_history.add_turn(user_text=user_text, assistant_text=assistant_text)

    def _write_log():
        try:
            with open(config.DIALOGUE_LOG_PATH, "a", encoding="utf-8") as f:
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{timestamp}] USER ({user_id}): {user_text}\n")
                f.write(f"[{timestamp}] BOT: {assistant_text}\n---\n")
        except Exception as e:
            log.error(f"Памылка пры захаванні дыялогу ў файл: {e}")

    await asyncio.to_thread(_write_log)

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
