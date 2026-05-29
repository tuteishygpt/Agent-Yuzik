import importlib
import os
import sys
from types import ModuleType
from types import SimpleNamespace

from google.adk.models.llm_request import LlmRequest
from google.genai import types


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_tool_module():
    sys.modules.pop("tools.minsk_datetime_tool", None)
    return importlib.import_module("tools.minsk_datetime_tool")


def _load_router_module():
    sys.modules.pop("router_agent.agent", None)
    saved_modules = {}
    module_names = [
        "google.adk.agents",
        "google.adk.tools",
        "tools.text_to_speech_tool",
        "tools.gemini_image_generator",
        "tools.minsk_datetime_tool",
        "tools.verbum_tool",
        "tools.weather_tool",
        "google_search_agent.agent",
        "meme_generator_agent.agent",
    ]
    for name in module_names:
        saved_modules[name] = sys.modules.get(name)

    fake_agents_module = ModuleType("google.adk.agents")

    class FakeLlmAgent:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    fake_agents_module.LlmAgent = FakeLlmAgent
    sys.modules["google.adk.agents"] = fake_agents_module

    fake_tools_module = ModuleType("google.adk.tools")

    class FakeBaseTool:
        def __init__(self, name="tool"):
            self.name = name

    class FakeToolContext:
        pass

    class FakeAgentTool(FakeBaseTool):
        def __init__(self, agent):
            super().__init__(name=agent.name)
            self.agent = agent

    fake_tools_module.ToolContext = FakeToolContext
    fake_tools_module.BaseTool = FakeBaseTool
    fake_tools_module.agent_tool = SimpleNamespace(AgentTool=FakeAgentTool)
    sys.modules["google.adk.tools"] = fake_tools_module

    fake_agent = lambda name: SimpleNamespace(name=name, description=f"{name} stub")
    fake_tts_module = ModuleType("tools.text_to_speech_tool")
    fake_tts_module.synthesize_speech_tool = SimpleNamespace(name="synthesize_speech_tool")
    sys.modules["tools.text_to_speech_tool"] = fake_tts_module

    fake_image_module = ModuleType("tools.gemini_image_generator")
    fake_image_module.generate_image_tool = SimpleNamespace(name="generate_image_tool")
    sys.modules["tools.gemini_image_generator"] = fake_image_module

    fake_datetime_module = ModuleType("tools.minsk_datetime_tool")
    fake_datetime_module.minsk_datetime_tool = SimpleNamespace(name="minsk_datetime_tool")
    sys.modules["tools.minsk_datetime_tool"] = fake_datetime_module

    fake_verbum_module = ModuleType("tools.verbum_tool")
    fake_verbum_module.verbum_tool = SimpleNamespace(name="verbum_tool")
    sys.modules["tools.verbum_tool"] = fake_verbum_module

    fake_weather_module = ModuleType("tools.weather_tool")
    fake_weather_module.weather_tool = SimpleNamespace(name="weather_tool")
    sys.modules["tools.weather_tool"] = fake_weather_module

    fake_search_module = ModuleType("google_search_agent.agent")
    fake_search_module.search_agent = fake_agent("search_agent")
    sys.modules["google_search_agent.agent"] = fake_search_module

    fake_meme_module = ModuleType("meme_generator_agent.agent")
    fake_meme_module.meme_agent = fake_agent("meme_agent")
    sys.modules["meme_generator_agent.agent"] = fake_meme_module

    try:
        return importlib.import_module("router_agent.agent")
    finally:
        for name, original in saved_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original


def test_get_minsk_datetime_sets_state_and_returns_minsk_timezone():
    module = _load_tool_module()
    tool_context = SimpleNamespace(state={})

    result = module.get_minsk_datetime(tool_context=tool_context)

    assert result["timezone"] == "Europe/Minsk"
    assert result["iso_datetime"].endswith("+03:00")
    assert result["date"]
    assert result["time"]
    assert tool_context.state["user:timezone"] == "Europe/Minsk"
    assert tool_context.state["user:minsk_time_enabled"] is True


def test_before_model_callback_enables_minsk_mode_for_time_queries():
    module = _load_router_module()
    callback_context = SimpleNamespace(state={})
    llm_request = LlmRequest(
        config=types.GenerateContentConfig(),
        contents=[
            types.Content(
                role="user",
                parts=[types.Part(text="Колькі цяпер часу ў Мінску?")],
            )
        ],
    )

    result = module.enable_minsk_time_mode(callback_context, llm_request)

    assert result is None
    assert callback_context.state["user:timezone"] == "Europe/Minsk"
    assert callback_context.state["user:minsk_time_enabled"] is True
    assert "minsk_datetime_tool" in llm_request.config.system_instruction
    assert "Europe/Minsk" in llm_request.config.system_instruction


def test_guard_one_call_only_blocks_second_tts_call():
    module = _load_router_module()
    callback_context = SimpleNamespace(state={})
    search_tool = SimpleNamespace(name="search_agent")
    tts_tool = SimpleNamespace(name="synthesize_speech_tool")

    assert module.guard_one_call(search_tool, {}, callback_context) is None
    assert callback_context.state.get("temp:tts_called") is None

    assert module.guard_one_call(tts_tool, {}, callback_context) is None
    assert callback_context.state["temp:tts_called"] is True

    error = module.guard_one_call(tts_tool, {}, callback_context)

    assert error["status"] == "error"
    assert "synthesize_speech_tool" in error["error_message"]
