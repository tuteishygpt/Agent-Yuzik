import asyncio
import importlib
import os
import sys
from types import ModuleType, SimpleNamespace


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _reload_config(monkeypatch, *, google_api_key=None, gemini_api_key=None, use_vertex=None):
    env_values = {
        "GOOGLE_API_KEY": "" if google_api_key is None else google_api_key,
        "GEMINI_API_KEY": "" if gemini_api_key is None else gemini_api_key,
        "GOOGLE_GENAI_USE_VERTEXAI": "" if use_vertex is None else use_vertex,
        "GOOGLE_CLOUD_PROJECT": "stale-project",
        "GOOGLE_CLOUD_LOCATION": "us-central1",
    }
    for key, value in env_values.items():
        monkeypatch.setenv(key, value)

    sys.modules.pop("config", None)
    return importlib.import_module("config")


def test_config_enables_vertex_express_and_clears_legacy_env_alias(monkeypatch):
    config = _reload_config(
        monkeypatch,
        google_api_key="vertex-key",
        gemini_api_key="stale-key",
        use_vertex="0",
    )

    assert config.GOOGLE_API_KEY == "vertex-key"
    assert config.GEMINI_API_KEY == "vertex-key"
    assert os.environ["GOOGLE_GENAI_USE_VERTEXAI"].lower() == "true"
    assert os.environ["GOOGLE_API_KEY"] == "vertex-key"
    assert "GEMINI_API_KEY" not in os.environ
    assert "GOOGLE_CLOUD_PROJECT" not in os.environ
    assert "GOOGLE_CLOUD_LOCATION" not in os.environ


def test_config_promotes_legacy_gemini_key_to_google_api_key_for_vertex_express(monkeypatch):
    config = _reload_config(
        monkeypatch,
        google_api_key=None,
        gemini_api_key="legacy-key",
        use_vertex=None,
    )

    assert config.GOOGLE_API_KEY == "legacy-key"
    assert config.GEMINI_API_KEY == "legacy-key"
    assert os.environ["GOOGLE_API_KEY"] == "legacy-key"
    assert os.environ["GOOGLE_GENAI_USE_VERTEXAI"].lower() == "true"
    assert "GEMINI_API_KEY" not in os.environ


def test_config_does_not_warn_when_service_account_vertex_configured(monkeypatch, capsys):
    monkeypatch.setenv("GOOGLE_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "service-account.json")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "vertex-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")

    sys.modules.pop("config", None)
    config = importlib.import_module("config")

    captured = capsys.readouterr()
    assert "GOOGLE_API_KEY not found" not in captured.out
    assert config.GOOGLE_API_KEY == ""


def test_adk_gemini_model_uses_vertex_backend_after_config_setup(monkeypatch):
    _reload_config(
        monkeypatch,
        google_api_key="vertex-key",
        gemini_api_key="stale-key",
        use_vertex="0",
    )

    from google.adk.models.google_llm import Gemini

    model = Gemini(model="gemini-2.5-flash")

    assert model.api_client.vertexai is True
    assert model._api_backend.name == "VERTEX_AI"


def test_config_exposes_adk_model_overrides(monkeypatch):
    config = _reload_config(
        monkeypatch,
        google_api_key="vertex-key",
        gemini_api_key=None,
        use_vertex="1",
    )

    monkeypatch.setenv("ADK_MODEL", "gemini-2.5-flash-lite")
    monkeypatch.setenv("ROUTER_AGENT_MODEL", "gemini-2.5-flash")
    monkeypatch.setenv("SEARCH_AGENT_MODEL", "gemini-2.0-flash-001")
    monkeypatch.setenv("MEME_AGENT_MODEL", "gemini-2.5-flash-lite")
    sys.modules.pop("config", None)
    config = importlib.import_module("config")

    assert config.ADK_MODEL == "gemini-2.5-flash-lite"
    assert config.ROUTER_AGENT_MODEL == "gemini-2.5-flash"
    assert config.SEARCH_AGENT_MODEL == "gemini-2.0-flash-001"
    assert config.MEME_AGENT_MODEL == "gemini-2.5-flash-lite"


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
    assert captured["vertexai"] is True
    assert captured["api_key"] == "vertex-key"
    retry_options = captured["http_options"].retry_options
    assert retry_options.attempts == 5
    assert retry_options.http_status_codes == [408, 429, 500, 502, 503, 504]


def test_config_genai_http_options_use_httpx_async_transport_for_streaming(monkeypatch):
    config = _reload_config(
        monkeypatch,
        google_api_key=None,
        gemini_api_key=None,
        use_vertex="true",
    )

    http_options = config.create_genai_http_options()

    transport = http_options.async_client_args["transport"]
    assert hasattr(transport, "handle_async_request")
    assert hasattr(transport, "aclose")


def test_config_create_adk_model_adds_retry_options(monkeypatch):
    config = _reload_config(
        monkeypatch,
        google_api_key="vertex-key",
        gemini_api_key=None,
        use_vertex="1",
    )

    model = config.create_adk_model("gemini-2.5-flash")

    assert model.model == "gemini-2.5-flash"
    assert model.retry_options.attempts == 5
    assert model.retry_options.http_status_codes == [408, 429, 500, 502, 503, 504]


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
    assert captured["vertexai"] is True
    assert captured["api_key"] == "vertex-key"
    assert captured["http_options"].retry_options.attempts == 5


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
