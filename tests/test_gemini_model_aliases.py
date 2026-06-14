from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET_FILES = [
    REPO_ROOT / "google_search_agent" / "agent.py",
    REPO_ROOT / "meme_generator_agent" / "agent.py",
    REPO_ROOT / "router_agent" / "agent.py",
]
def test_target_files_use_config_backed_adk_models():
    for path in TARGET_FILES:
        text = path.read_text(encoding="utf-8")
        assert "config." in text, f"{path.name} should read its model from config"
        assert "_MODEL" in text, f"{path.name} should use a dedicated model setting"
        assert "gemini-2.5-flash" not in text, (
            f"{path.name} should not hardcode the default ADK model"
        )
        assert "gemini-flash-latest" not in text, (
            f"{path.name} should not use the Gemini Developer API alias"
        )


def test_image_generation_is_route_first_not_router_tool():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    workflow_text = (REPO_ROOT / "yuzik_workflow" / "image_workflow.py").read_text(
        encoding="utf-8"
    )
    assert "from tools.gemini_image_generator import generate_image" in workflow_text
    assert "from tools.gemini_image_generator import generate_image_tool" not in text
    assert "from tools.flux_generator import generate_image_tool" not in text


def test_router_agent_uses_minsk_datetime_tool():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    assert "from tools.minsk_datetime_tool import minsk_datetime_tool" in text
    assert "minsk_datetime_tool" in text


def test_router_agent_imports_weather_tool_and_mentions_minsk_default():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    assert "from tools.weather_tool import weather_tool" in text
    assert "`weather_tool`" in text
    assert "Мінск" in text
    assert "weather_tool," in text


def test_router_agent_imports_dictionary_tool_and_mentions_dictionary_routing():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    assert "from tools.dictionary_tool import dictionary_tool" in text
    assert "`dictionary_tool`" in text
    assert "Slounik.org" in text
    assert "Verbum" in text
    assert "dictionary_tool," in text
