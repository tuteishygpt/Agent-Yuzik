import asyncio
import importlib
import os
import sys
from types import ModuleType, SimpleNamespace


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def test_config_create_genai_client_uses_vertex_ai_express_mode(monkeypatch):
    import config

    captured = {}
    fake_client = object()

    monkeypatch.setattr(config, "GOOGLE_API_KEY", "vertex-key")
    monkeypatch.setattr(config, "GEMINI_API_KEY", None)

    def fake_client_factory(**kwargs):
        captured.update(kwargs)
        return fake_client

    monkeypatch.setattr(config.genai, "Client", fake_client_factory)

    client = config.create_genai_client()

    assert client is fake_client
    assert captured == {
        "vertexai": True,
        "api_key": "vertex-key",
    }


def test_api_deps_get_genai_client_uses_shared_vertex_client_factory(monkeypatch):
    fake_adk_module = ModuleType("services.adk_service")
    fake_adk_module.ADKService = lambda: object()
    monkeypatch.setitem(sys.modules, "services.adk_service", fake_adk_module)
    sys.modules.pop("api.deps", None)

    deps = importlib.import_module("api.deps")
    fake_client = object()
    calls = []

    monkeypatch.setattr(
        deps.config,
        "create_genai_client",
        lambda: calls.append("called") or fake_client,
        raising=False,
    )

    deps._genai_client = None

    assert not hasattr(deps, "genai")
    assert deps.get_genai_client() is fake_client
    assert deps.get_genai_client() is fake_client
    assert calls == ["called"]


def test_image_generator_sdk_client_uses_vertex_ai_express_mode(monkeypatch):
    sys.modules.pop("tools.gemini_image_generator", None)
    module = importlib.import_module("tools.gemini_image_generator")

    captured = {}
    fake_client = object()

    monkeypatch.setattr(module.config, "GOOGLE_API_KEY", "vertex-key")
    monkeypatch.setattr(module.config, "GEMINI_API_KEY", None)

    def fake_client_factory(**kwargs):
        captured.update(kwargs)
        return fake_client

    monkeypatch.setattr(module.genai, "Client", fake_client_factory)

    client = module._get_genai_client()

    assert client is fake_client
    assert captured == {
        "vertexai": True,
        "api_key": "vertex-key",
    }


def test_image_generator_rest_fallback_uses_vertex_ai_express_endpoint(monkeypatch):
    sys.modules.pop("tools.gemini_image_generator", None)
    module = importlib.import_module("tools.gemini_image_generator")

    captured = {}

    monkeypatch.setattr(module.config, "GOOGLE_API_KEY", "vertex-key")
    monkeypatch.setattr(module.config, "GEMINI_API_KEY", None)

    class FakeResponse:
        status = 200

        async def text(self):
            return '{"candidates": []}'

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClientSession:
        def __init__(self, *, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, url, *, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr(module.aiohttp, "ClientSession", FakeClientSession)

    asyncio.run(
        module._generate_gemini_parts_via_rest(
            model="gemini-2.5-flash-image",
            prompt="sunrise",
            aspect_ratio="16:9",
            person_generation="ALLOW_ADULT",
            output_mime_type="image/png",
        )
    )

    assert (
        captured["url"]
        == "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-image:generateContent?key=vertex-key"
    )
    assert captured["headers"] == {
        "Content-Type": "application/json",
    }
    assert captured["json"]["generationConfig"]["responseModalities"] == ["IMAGE"]
