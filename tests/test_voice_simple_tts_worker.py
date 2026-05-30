import asyncio
import importlib
import os
import sys
import time
from types import ModuleType, SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_voice_simple(monkeypatch):
    started = asyncio.Event()

    fake_deps = ModuleType("api.deps")
    fake_deps.get_genai_client = lambda: None
    fake_deps.get_voice_genai_client = lambda: None
    monkeypatch.setitem(sys.modules, "api.deps", fake_deps)

    fake_teacher_service = ModuleType("api.teacher_mode.service")
    fake_teacher_service.controller = SimpleNamespace(get_state=lambda **kwargs: None)
    monkeypatch.setitem(sys.modules, "api.teacher_mode.service", fake_teacher_service)

    fake_voice_history = ModuleType("api.voice_history")
    fake_voice_history.get_voice_history = lambda user_id: SimpleNamespace(
        turn_count=0,
        to_gemini_contents=lambda: [],
    )
    monkeypatch.setitem(sys.modules, "api.voice_history", fake_voice_history)

    fake_voice_perf = ModuleType("api.voice_perf")
    fake_voice_perf.PerfLogger = object
    monkeypatch.setitem(sys.modules, "api.voice_perf", fake_voice_perf)

    fake_voice_utils = ModuleType("api.voice_utils")
    fake_voice_utils.LOCAL_SAMPLE_RATE = 16000
    monkeypatch.setitem(sys.modules, "api.voice_utils", fake_voice_utils)

    fake_tts = ModuleType("tools.text_to_speech_tool")

    async def _unused_stream_speech(*args, **kwargs):
        if False:
            yield b""

    async def _hanging_stream_speech_multi(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()
        if False:
            yield b""

    fake_tts.stream_speech = _unused_stream_speech
    fake_tts.stream_speech_multi = _hanging_stream_speech_multi
    monkeypatch.setitem(sys.modules, "tools.text_to_speech_tool", fake_tts)

    sys.modules.pop("api.voice_simple", None)
    return importlib.import_module("api.voice_simple"), started


def test_tts_worker_stop_does_not_wait_forever_on_stuck_stream(monkeypatch):
    voice_simple, started = _load_voice_simple(monkeypatch)
    monkeypatch.setattr(voice_simple, "_TTS_IDLE_STOP_TIMEOUT_S", 0.01)
    monkeypatch.setattr(voice_simple, "_TTS_ACTIVE_STOP_TIMEOUT_S", 0.2)

    async def perf(*args, **kwargs):
        return None

    async def scenario():
        worker = voice_simple.TTSWorker(
            audio_queue=asyncio.Queue(),
            perf=perf,
            start_ts=time.time(),
        )
        worker.start()
        await started.wait()
        await worker.stop()

    asyncio.run(asyncio.wait_for(scenario(), timeout=0.2))


def test_remote_asr_sends_audio_inline_and_runs_side_channel(monkeypatch):
    voice_simple, _ = _load_voice_simple(monkeypatch)
    monkeypatch.setattr(voice_simple.config, "LOCAL_ASR", False)

    side_channel_called = asyncio.Event()

    async def transcribe_audio(audio_data):
        side_channel_called.set()
        assert audio_data == b"wav"
        return "прывітанне"

    monkeypatch.setattr(voice_simple, "_transcribe_audio_with_model", transcribe_audio)

    class FakeWebSocket:
        def __init__(self):
            self.messages = []

        async def send_json(self, message):
            self.messages.append(message)

    async def perf(*args, **kwargs):
        pass

    websocket = FakeWebSocket()

    async def scenario():
        transcription, content, task = await voice_simple._transcribe_remote(
            audio_data=b"wav",
            websocket=websocket,
            perf=perf,
            start_ts=time.time(),
        )
        # Audio goes inline to the main LLM call, not as transcribed text.
        assert transcription is None
        assert content.parts[0].text is None
        assert content.parts[0].inline_data is not None
        assert content.parts[0].inline_data.data == b"wav"
        assert content.parts[0].inline_data.mime_type == "audio/wav"
        # Side-channel runs in parallel and is awaitable.
        assert task is not None
        text = await task
        assert text == "прывітанне"
        assert side_channel_called.is_set()
        assert {"type": "transcription", "text": "прывітанне"} in websocket.messages

    asyncio.run(asyncio.wait_for(scenario(), timeout=0.5))


def test_tts_worker_stop_waits_for_slow_active_tts(monkeypatch):
    voice_simple, _ = _load_voice_simple(monkeypatch)
    monkeypatch.setattr(voice_simple, "_TTS_IDLE_STOP_TIMEOUT_S", 0.01)
    monkeypatch.setattr(voice_simple, "_TTS_ACTIVE_STOP_TIMEOUT_S", 0.2)

    generation_started = asyncio.Event()

    async def slow_stream(sentence_queue, cancel_event=None, **kwargs):
        sentence = await sentence_queue.get()
        assert sentence == "hello"
        generation_started.set()
        await asyncio.sleep(0.05)
        yield b"audio"
        assert await sentence_queue.get() is None

    monkeypatch.setattr(voice_simple, "stream_speech_multi", slow_stream)

    async def perf(*args, **kwargs):
        return None

    async def scenario():
        audio_queue = asyncio.Queue()
        worker = voice_simple.TTSWorker(
            audio_queue=audio_queue,
            perf=perf,
            start_ts=time.time(),
        )
        worker.start()
        await worker.dispatch("hello")
        await generation_started.wait()
        await worker.stop()
        assert await audio_queue.get() == b"audio"

    asyncio.run(asyncio.wait_for(scenario(), timeout=0.2))


