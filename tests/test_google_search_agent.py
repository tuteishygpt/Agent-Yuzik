import importlib
import os
import sys
from pathlib import Path
from types import ModuleType
from types import SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, os.path.abspath(REPO_ROOT))


def test_search_agent_imports_when_google_search_is_only_available_via_tool_module():
    sys.modules.pop("google_search_agent.agent", None)

    saved_modules = {}
    module_names = [
        "google.adk.agents",
        "google.adk.tools",
        "google.adk.tools.google_search_tool",
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
    sys.modules["google.adk.tools"] = fake_tools_module

    fake_google_search_tool_module = ModuleType("google.adk.tools.google_search_tool")

    class FakeGoogleSearchTool:
        def __init__(self):
            self.name = "google_search"

    fake_google_search_tool_module.GoogleSearchTool = FakeGoogleSearchTool
    sys.modules["google.adk.tools.google_search_tool"] = fake_google_search_tool_module

    try:
        module = importlib.import_module("google_search_agent.agent")
    finally:
        for name, original in saved_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original
        sys.modules.pop("google_search_agent.agent", None)

    assert module.search_agent.name == "search_agent"
    assert len(module.search_agent.tools) == 1
    assert isinstance(module.search_agent.tools[0], FakeGoogleSearchTool)
    assert module.search_agent.tools[0].name == "google_search"
