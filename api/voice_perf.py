# api/voice_perf.py
"""
Structured performance logger for voice pipeline.

Encapsulates perf event tracking, timing, and WebSocket delivery
so that handler code stays clean.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Set

from fastapi import WebSocket

import config

log = logging.getLogger("app.voice")

# Events that are always forwarded to the client UI (even after first audio)
ALWAYS_SHOW_EVENTS: Set[str] = {
    "tts_complete", "llm_complete", "llm_stream_end", "pipeline_complete",
    # Post-first-audio events that are still useful in UI
    "history_loaded", "tts_worker_start", "tts_worker_done",
    "split_group_flush", "split_final_flush", "history_saved",
    "tts_sentence_done",
}


class PerfLogger:
    """Per-request performance logger.

    Tracks elapsed / delta timings and sends structured perf_log events
    to the client via WebSocket. After the first audio chunk reaches the
    queue, only summary events are forwarded to the client UI; all events
    are always logged server-side.
    """

    def __init__(self, websocket: WebSocket, start_ts: float):
        self._ws = websocket
        self._start_ts = start_ts
        self._step_ts = start_ts
        self._first_audio_sent = False

    @property
    def start_ts(self) -> float:
        return self._start_ts

    async def __call__(
        self,
        event: str,
        label: str,
        detail: str = "",
        duration_ms: int = 0,
    ):
        """Emit a perf event."""
        now_utc = datetime.now(timezone.utc)
        elapsed = round((time.time() - self._start_ts) * 1000)
        delta = round((time.time() - self._step_ts) * 1000)
        self._step_ts = time.time()

        msg = {
            "type": "perf_log",
            "event": event,
            "label": label,
            "detail": detail,
            "timestamp": now_utc.isoformat(),
            "elapsed_ms": elapsed,
            "delta_ms": delta,
            "duration_ms": duration_ms,
        }
        log.info(f"[Perf] {label} | {detail} | elapsed={elapsed}ms | Δ={delta}ms")

        # Track when first audio reaches the queue
        if event == "tts_first_chunk":
            self._first_audio_sent = True

        # Decide whether to send to client UI
        show_to_client = (
            not self._first_audio_sent
            or event in ALWAYS_SHOW_EVENTS
            or event == "tts_first_chunk"
        )

        if config.SIMPLE_VOICE_DEBUG_TIMESTAMPS and show_to_client:
            try:
                await self._ws.send_json(msg)
            except Exception:
                pass
