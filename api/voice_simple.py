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
import time
from typing import Callable, Awaitable

from fastapi import WebSocket
from google.genai import types

import config
from api.deps import get_genai_client
from api.voice_perf import PerfLogger
from api.voice_utils import LOCAL_SAMPLE_RATE
from tools.text_to_speech_tool import stream_speech

log = logging.getLogger("app.voice")

# Regex for detecting sentence boundaries
_SENTENCE_END_RE = re.compile(r'[.!?…\n]+[\s»")\]]+')

# Max characters to group into a single TTS chunk (after the first segment)
_GROUP_LIMIT = 250


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

        # State
        self.sent_first_audio_chunk = False
        self._first_dispatch_ts: float | None = None
        self.llm_first_token_ts: float | None = None

    @property
    def sentence_queue(self) -> asyncio.Queue:
        return self._sentence_queue

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self._run())
        return self._task

    async def stop(self):
        """Signal the worker to stop and wait for it to finish."""
        await self._sentence_queue.put(None)  # Sentinel
        if self._task:
            await self._task

    def cancel(self):
        if self._task and not self._task.done():
            self._task.cancel()

    async def dispatch(self, text: str):
        """Send text to the TTS queue with logging."""
        if self._first_dispatch_ts is None:
            self._first_dispatch_ts = time.time()
        log.info(f"[VOICE·TIMING] Dispatch to TTS ({len(text)} chars): {text[:80]}...")
        await self._perf(
            "tts_dispatch",
            "✂️ Тэкст → чарга TTS",
            detail=f"({len(text)} сімв.): {text[:120]} | "
                   f"Ад старту: {(time.time()-self._start_ts)*1000:.0f} мс",
        )
        await self._sentence_queue.put(text)

    # ── Internal worker loop ──

    async def _run(self):
        tts_gen_start = None
        tts_chunk_count = 0
        tts_total_audio_samples = 0
        sentence_idx = 0

        try:
            while True:
                t_queue_wait = time.time()
                sentence = await self._sentence_queue.get()
                queue_wait_ms = (time.time() - t_queue_wait) * 1000
                if sentence is None:
                    break  # Sentinel

                sentence_idx += 1

                if tts_gen_start is None:
                    tts_gen_start = time.time()
                    dispatch_to_worker_ms = (
                        (tts_gen_start - self._first_dispatch_ts) * 1000
                        if self._first_dispatch_ts else 0
                    )
                    await self._perf(
                        "tts_start",
                        "🔊 Пачатак TTS генерацыі",
                        detail=f"Даўжыня тэксту: {len(sentence)} сімв. | "
                               f"Рэжым: {config.TTS_MODE} | "
                               f"Чарга→worker: {dispatch_to_worker_ms:.0f} мс | "
                               f"Queue wait: {queue_wait_ms:.0f} мс",
                        duration_ms=round((time.time() - self._start_ts) * 1000),
                    )

                t_sentence_start = time.time()
                log.info(
                    f"[VOICE·TIMING] TTS Worker: sentence #{sentence_idx} "
                    f"({len(sentence)} chars): {sentence[:80]}..."
                )
                sentence_chunk_count = 0
                first_chunk_in_sentence = True

                async for audio_chunk in stream_speech(sentence):
                    tts_chunk_count += 1
                    sentence_chunk_count += 1

                    chunk_samples = len(audio_chunk) // 4 if config.TTS_MODE == "local" else 0
                    tts_total_audio_samples += chunk_samples

                    if first_chunk_in_sentence:
                        sentence_first_chunk_ms = (time.time() - t_sentence_start) * 1000
                        await self._perf(
                            "tts_sentence_first_chunk",
                            f"🔉 Сказ #{sentence_idx}: першы чанк",
                            detail=f"Inference сказа: {sentence_first_chunk_ms:.0f} мс | "
                                   f"{len(sentence)} сімв. | "
                                   f"Ад старту: {(time.time()-self._start_ts)*1000:.0f} мс",
                            duration_ms=round(sentence_first_chunk_ms),
                        )
                        first_chunk_in_sentence = False

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
                                f"({chunk_samples/LOCAL_SAMPLE_RATE*1000:.0f} мс аўдыё)"
                            )
                        await self._perf(
                            "tts_first_chunk",
                            "🔊 Першы аўдыя чанк TTS → чарга",
                            detail=f"🏁 Пайплайн: {pipeline_ms:.0f} мс | "
                                   f"TTS: {tts_ms:.0f} мс | "
                                   f"LLM→TTS: {llm_to_tts_ms:.0f} мс{chunk_info}",
                            duration_ms=round(pipeline_ms),
                        )
                        log.info(
                            f"[VOICE·TIMING] 🎵 First audio chunk → queue: "
                            f"pipeline={pipeline_ms:.0f} ms, tts={tts_ms:.0f} ms"
                        )
                        self.sent_first_audio_chunk = True

                    t_put = time.time()
                    await self._audio_queue.put(audio_chunk)
                    put_ms = (time.time() - t_put) * 1000
                    if put_ms > 5:
                        log.info(
                            f"[VOICE·TIMING] ⚠️ audio_queue.put slow: "
                            f"{put_ms:.1f} ms (chunk #{tts_chunk_count})"
                        )

                sentence_ms = (time.time() - t_sentence_start) * 1000
                log.info(
                    f"[VOICE·TIMING] Sentence #{sentence_idx} done: "
                    f"{sentence_chunk_count} chunks in {sentence_ms:.0f} ms"
                )
                await self._perf(
                    "tts_sentence_done",
                    f"✅ Сказ #{sentence_idx} завершаны",
                    detail=f"{sentence_chunk_count} чанкаў за {sentence_ms:.0f} мс | "
                           f"Čарга wait: {queue_wait_ms:.0f} мс",
                    duration_ms=round(sentence_ms),
                )
                self._sentence_queue.task_done()

        except Exception as e:
            log.error(f"TTS Worker Error: {e}")

        finally:
            if tts_gen_start:
                total_tts_ms = (time.time() - tts_gen_start) * 1000
                total_audio_ms = (
                    tts_total_audio_samples / LOCAL_SAMPLE_RATE * 1000
                    if config.TTS_MODE == "local" else 0
                )
                rtf = total_tts_ms / total_audio_ms if total_audio_ms > 0 else 0
                await self._perf(
                    "tts_complete",
                    "✅ TTS генерацыя завершана",
                    detail=f"Час TTS: {total_tts_ms:.0f} мс | "
                           f"Чанкаў: {tts_chunk_count} | "
                           f"Аўдыё: {total_audio_ms:.0f} мс | "
                           f"RTF: {rtf:.2f}x | "
                           f"Сказаў: {sentence_idx}",
                    duration_ms=round(total_tts_ms),
                )


# ── Main handler ─────────────────────────────────────────────────────

async def handle_simple_voice(
    audio_data: bytes,
    websocket: WebSocket,
    audio_queue: asyncio.Queue,
    perf: PerfLogger,
):
    """Process audio via Simple Voice Agent (direct Gemini → TTS streaming)."""
    start_ts = perf.start_ts
    gen_start = time.time()

    await perf(
        "llm_start",
        "🤖 Запуск LLM мадэлі",
        detail=f"Мадэль: {config.SIMPLE_VOICE_MODEL} | аўдыё: {len(audio_data)} байт",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    client = get_genai_client()

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
            system_instruction=config.SIMPLE_VOICE_SYSTEM_PROMPT,
            temperature=0.7,
        ),
    )
    api_call_ms = (time.time() - t_api_call) * 1000

    await perf(
        "llm_stream_created",
        "📡 LLM стрым створаны",
        detail=f"API выклік: {api_call_ms:.0f} мс | "
               f"Ад старту: {(time.time() - start_ts)*1000:.0f} мс",
        duration_ms=round(api_call_ms),
    )

    # ── TTS Worker ──
    tts = TTSWorker(audio_queue, perf, start_ts)
    worker_task = tts.start()

    # ── LLM stream processing with sentence grouping ──
    text_buffer = ""
    sentence_buffer = ""
    group_buffer = ""
    first_token = True
    first_sentence_ready = False
    first_tts_dispatched = False
    total_llm_tokens = 0
    llm_end_ts = gen_start  # fallback

    try:
        t_first_iter = time.time()
        async for chunk in response_stream:
            if not chunk.text:
                continue

            total_llm_tokens += 1

            if first_token:
                tts.llm_first_token_ts = time.time()
                ttft_ms = (tts.llm_first_token_ts - gen_start) * 1000
                iter_wait_ms = (tts.llm_first_token_ts - t_first_iter) * 1000
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

            await websocket.send_json({
                "type": "response",
                "text": text_buffer,
            })

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
                if len(group_buffer) >= config.TTS_FIRST_SEGMENT_LIMIT:
                    if not first_sentence_ready:
                        first_sentence_ready = True
                        sentence_ready_ms = (time.time() - gen_start) * 1000
                        await perf(
                            "llm_first_sentence",
                            "📝 Першы сказ гатовы для TTS",
                            detail=f"Час: {sentence_ready_ms:.0f} мс | "
                                   f"{len(group_buffer)} сімв. | "
                                   f"LLM токенаў: {total_llm_tokens} | "
                                   f"Тэкст: «{group_buffer[:80]}»",
                            duration_ms=round(sentence_ready_ms),
                        )
                    await tts.dispatch(group_buffer)
                    group_buffer = ""
                    first_tts_dispatched = True
            else:
                # Group subsequent sentences into larger chunks
                if group_buffer and len(group_buffer) + 1 + len(ready) > _GROUP_LIMIT:
                    if group_buffer.strip():
                        await tts.dispatch(group_buffer.strip())
                        group_buffer = ""
                group_buffer = f"{group_buffer} {ready}".strip() if group_buffer else ready

        llm_end_ts = time.time()
        llm_total_ms = (llm_end_ts - gen_start) * 1000
        await perf(
            "llm_stream_end",
            "📡 LLM стрым скончыўся",
            detail=f"Агульна: {llm_total_ms:.0f} мс | "
                   f"Токенаў: {total_llm_tokens} | "
                   f"Тэкст: {len(text_buffer)} сімв.",
            duration_ms=round(llm_total_ms),
        )

        # ── Flush remaining text ──
        leftover = sentence_buffer.strip()
        if leftover:
            group_buffer = f"{group_buffer} {leftover}".strip() if group_buffer else leftover

        if group_buffer.strip():
            await tts.dispatch(group_buffer.strip())

        await tts.stop()

    finally:
        tts.cancel()

    total_ms = (time.time() - start_ts) * 1000
    await perf(
        "llm_complete",
        "🏁 Пайплайн Simple Voice завершаны",
        detail=f"Агульны час: {total_ms:.0f} мс | "
               f"LLM: {(llm_end_ts - gen_start)*1000:.0f} мс | "
               f"Тэкст: {len(text_buffer)} сімв.",
        duration_ms=round(total_ms),
    )
