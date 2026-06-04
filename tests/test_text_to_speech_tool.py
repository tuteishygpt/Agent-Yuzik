import asyncio
import importlib
import os
import sys
from types import ModuleType

import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_tts_module(monkeypatch):
    monkeypatch.setenv("TTS_MODE", "api")
    monkeypatch.setenv("ADK_TTS_MODE", "api")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_TOKEN", raising=False)

    sys.modules.pop("config", None)
    sys.modules.pop("tools.text_to_speech_tool", None)

    fake_gradio_client = ModuleType("gradio_client")

    class DummyClient:
        def __init__(self, *args, **kwargs):
            self.src = "https://fake.space/"
            self.headers = {}
            self.cookies = {}
            self.ssl_verify = True
            self.httpx_kwargs = {}

        def predict(self, *args, **kwargs):
            return None

    fake_gradio_client.Client = DummyClient
    fake_gradio_client.handle_file = lambda path: {
        "path": path,
        "meta": {"_type": "gradio.FileData"},
    }
    monkeypatch.setitem(sys.modules, "gradio_client", fake_gradio_client)

    return importlib.import_module("tools.text_to_speech_tool")


def _install_fake_local_xtts(monkeypatch, *, output_path=None):
    fake_local_xtts = ModuleType("services.local_xtts_service")

    async def fake_stream_audio(*args, **kwargs):
        yield b"local-stream"

    def fake_synthesize_to_file(text, tmp_path, speaker_audio_path=None):
        return output_path or tmp_path

    fake_local_xtts.stream_audio = fake_stream_audio
    fake_local_xtts.synthesize_to_file = fake_synthesize_to_file
    monkeypatch.setitem(sys.modules, "services.local_xtts_service", fake_local_xtts)
    return fake_local_xtts


def test_stream_speech_api_reads_audio_from_filedata_url(monkeypatch):
    wav_bytes = b"RIFFfake-wav-data"
    requested = {}

    class FakeResponse:
        def __init__(self, content):
            self.content = content

        def raise_for_status(self):
            return None

    def fake_httpx_get(url, **kwargs):
        requested["url"] = url
        requested["kwargs"] = kwargs
        return FakeResponse(wav_bytes)

    tts = _load_tts_module(monkeypatch)
    monkeypatch.setattr(httpx, "get", fake_httpx_get)

    class FakeJob:
        def __iter__(self):
            yield {
                "path": "/tmp/gradio/tts.wav",
                "url": "/gradio_api/file=/tmp/gradio/tts.wav",
                "meta": {"_type": "gradio.FileData"},
            }

    class FakeVoiceClient:
        src = "https://fake.space/"
        headers = {"Authorization": "Bearer test"}
        cookies = {"session": "cookie"}
        ssl_verify = True
        httpx_kwargs = {"timeout": 10}

        def submit(self, **kwargs):
            return FakeJob()

    monkeypatch.setattr(tts, "voice_client", FakeVoiceClient())

    async def collect():
        return [chunk async for chunk in tts._stream_speech_api("Прывітанне")]

    chunks = asyncio.run(collect())

    assert chunks == [wav_bytes]
    assert requested["url"] == "https://fake.space/gradio_api/file=/tmp/gradio/tts.wav"


def test_adk_tts_mode_defaults_to_api_independently_of_global_tts_mode(monkeypatch):
    monkeypatch.setenv("TTS_MODE", "local")
    monkeypatch.delenv("ADK_TTS_MODE", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_TOKEN", raising=False)

    sys.modules.pop("config", None)
    sys.modules.pop("tools.text_to_speech_tool", None)
    _install_fake_local_xtts(monkeypatch)

    fake_gradio_client = ModuleType("gradio_client")

    class DummyClient:
        def __init__(self, *args, **kwargs):
            self.src = "https://fake.space/"
            self.headers = {}
            self.cookies = {}
            self.ssl_verify = True
            self.httpx_kwargs = {}

    fake_gradio_client.Client = DummyClient
    fake_gradio_client.handle_file = lambda path: {"path": path}
    monkeypatch.setitem(sys.modules, "gradio_client", fake_gradio_client)

    tts = importlib.import_module("tools.text_to_speech_tool")

    assert tts.TTS_MODE == "local"
    assert tts.ADK_TTS_MODE == "api"


def test_synthesize_speech_falls_back_to_local_when_api_fails(monkeypatch, tmp_path):
    tts = _load_tts_module(monkeypatch)
    wav_path = tmp_path / "fallback.wav"
    wav_path.write_bytes(b"RIFFfallback-wav")

    async def failing_api(text, speaker_audio_path=None):
        raise RuntimeError("api unavailable")

    async def fallback_local(text, speaker_audio_path=None):
        return str(wav_path)

    saved = {}

    class FakeToolContext:
        async def save_artifact(self, *, filename, artifact):
            saved["filename"] = filename
            saved["artifact"] = artifact
            return tts.types.Part(text="saved artifact")

    monkeypatch.setattr(tts, "_synthesize_api", failing_api)
    monkeypatch.setattr(tts, "_synthesize_local", fallback_local)

    result = asyncio.run(tts.synthesize_speech("Прывітанне", tool_context=FakeToolContext()))

    assert result.text == "saved artifact"
    assert saved["filename"] == "tts_output.wav"
    assert saved["artifact"].inline_data.mime_type == "audio/wav"
    assert saved["artifact"].inline_data.data == b"RIFFfallback-wav"


def test_api_mode_uses_hf_token_keyword_for_gradio_client(monkeypatch):
    monkeypatch.setenv("TTS_MODE", "api")
    monkeypatch.setenv("HF_TOKEN", "secret-token")
    monkeypatch.delenv("HUGGINGFACE_API_TOKEN", raising=False)

    sys.modules.pop("config", None)
    sys.modules.pop("tools.text_to_speech_tool", None)

    captured = []
    fake_gradio_client = ModuleType("gradio_client")

    class DummyClient:
        def __init__(self, src, hf_token=None, **kwargs):
            if "token" in kwargs:
                raise TypeError("unexpected keyword argument 'token'")
            captured.append((src, hf_token))
            self.src = "https://fake.space/"
            self.headers = {}
            self.cookies = {}
            self.ssl_verify = True
            self.httpx_kwargs = {}

        def predict(self, *args, **kwargs):
            return None

    fake_gradio_client.Client = DummyClient
    fake_gradio_client.handle_file = lambda path: {
        "path": path,
        "meta": {"_type": "gradio.FileData"},
    }
    monkeypatch.setitem(sys.modules, "gradio_client", fake_gradio_client)

    importlib.import_module("tools.text_to_speech_tool")

    assert captured == [
        ("archivartaunik/Bextts", "secret-token"),
        ("archivartaunik/BexttsAssist", "secret-token"),
    ]


def test_api_mode_falls_back_to_token_keyword_for_newer_gradio_client(monkeypatch):
    monkeypatch.setenv("TTS_MODE", "api")
    monkeypatch.setenv("HF_TOKEN", "secret-token")
    monkeypatch.delenv("HUGGINGFACE_API_TOKEN", raising=False)

    sys.modules.pop("config", None)
    sys.modules.pop("tools.text_to_speech_tool", None)

    captured = []
    fake_gradio_client = ModuleType("gradio_client")

    class DummyClient:
        def __init__(self, src, token=None, **kwargs):
            if "hf_token" in kwargs:
                raise TypeError("unexpected keyword argument 'hf_token'")
            captured.append((src, token))
            self.src = "https://fake.space/"
            self.headers = {}
            self.cookies = {}
            self.ssl_verify = True
            self.httpx_kwargs = {}

        def predict(self, *args, **kwargs):
            return None

    fake_gradio_client.Client = DummyClient
    fake_gradio_client.handle_file = lambda path: {
        "path": path,
        "meta": {"_type": "gradio.FileData"},
    }
    monkeypatch.setitem(sys.modules, "gradio_client", fake_gradio_client)

    importlib.import_module("tools.text_to_speech_tool")

    assert captured == [
        ("archivartaunik/Bextts", "secret-token"),
        ("archivartaunik/BexttsAssist", "secret-token"),
    ]


def test_synthesize_api_uses_available_named_endpoint(monkeypatch):
    tts = _load_tts_module(monkeypatch)
    observed = {}

    class FakePredictClient:
        config = {"dependencies": [{"id": 0, "api_name": "text_to_speech"}]}

        class Endpoint:
            api_name = "/text_to_speech"
            is_valid = True
            backend_fn = 0
            show_api = True
            fn_index = 0
            parameters_info = [
                {
                    "label": "Text input",
                    "parameter_name": "text_input",
                    "component": "textbox",
                    "type": {},
                    "python_type": {},
                    "example_input": "Прывітанне",
                },
                {
                    "label": "Speaker audio",
                    "parameter_name": "speaker_audio",
                    "component": "audio",
                    "type": {},
                    "python_type": {},
                    "example_input": None,
                    "parameter_has_default": True,
                    "parameter_default": None,
                },
            ]

        endpoints = {0: Endpoint()}

        def predict(self, *args, **kwargs):
            api_name = kwargs.get("api_name")
            if api_name != "/text_to_speech":
                raise ValueError(
                    f"Cannot find a function with `api_name`: {api_name}."
                )
            if "belarusian_story" in kwargs or "speaker_audio_file" in kwargs:
                raise TypeError("Legacy keyword arguments should not be used.")
            observed["api_name"] = api_name
            observed["kwargs"] = kwargs
            return "/tmp/generated.wav"

    monkeypatch.setattr(tts, "gradio_client", FakePredictClient())

    async def synthesize():
        return await tts._synthesize_api("Прывітанне")

    result = asyncio.run(synthesize())

    assert result == "/tmp/generated.wav"
    assert observed["api_name"] == "/text_to_speech"
    assert observed["kwargs"]["text_input"] == "Прывітанне"
    assert observed["kwargs"]["speaker_audio"] is None


def test_synthesize_api_preserves_legacy_predict_signature(monkeypatch):
    tts = _load_tts_module(monkeypatch)
    observed = {}

    class FakePredictClient:
        config = {"dependencies": [{"id": 0, "api_name": "predict"}]}

        class Endpoint:
            api_name = "/predict"
            is_valid = True
            backend_fn = 0
            show_api = True
            fn_index = 0
            parameters_info = [
                {
                    "label": "Belarusian story",
                    "parameter_name": "belarusian_story",
                    "component": "textbox",
                    "type": {},
                    "python_type": {},
                    "example_input": "Прывітанне",
                },
                {
                    "label": "Speaker audio file",
                    "parameter_name": "speaker_audio_file",
                    "component": "audio",
                    "type": {},
                    "python_type": {},
                    "example_input": None,
                    "parameter_has_default": True,
                    "parameter_default": None,
                },
            ]

        endpoints = {0: Endpoint()}

        def predict(self, *args, **kwargs):
            observed["api_name"] = kwargs.get("api_name")
            observed["kwargs"] = kwargs
            return "/tmp/legacy.wav"

    monkeypatch.setattr(tts, "gradio_client", FakePredictClient())

    async def synthesize():
        return await tts._synthesize_api("Прывітанне")

    result = asyncio.run(synthesize())

    assert result == "/tmp/legacy.wav"
    assert observed["api_name"] == "/predict"
    assert observed["kwargs"]["belarusian_story"] == "Прывітанне"
    assert observed["kwargs"]["speaker_audio_file"] is None
def test_synthesize_speech_tool_exposes_manual_adk_declaration(monkeypatch):
    tts = _load_tts_module(monkeypatch)

    declaration = tts.synthesize_speech_tool._get_declaration()

    assert declaration.name == "synthesize_speech"
    assert declaration.parameters is not None
    assert declaration.parameters.properties is not None
    assert set(declaration.parameters.properties.keys()) == {"text", "speaker_audio_path"}
    assert declaration.parameters.properties["text"].type == "STRING"
    assert declaration.parameters.properties["speaker_audio_path"].type == "STRING"
    assert declaration.response is None
