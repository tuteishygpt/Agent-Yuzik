from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET_FILES = [
    REPO_ROOT / "google_search_agent" / "agent.py",
    REPO_ROOT / "meme_generator_agent" / "agent.py",
    REPO_ROOT / "router_agent" / "agent.py",
]
VERSIONED_GEMINI_PATTERN = re.compile(r"gemini-\d+(?:\.\d+)?-[a-z0-9-]+")


def test_target_files_use_unversioned_gemini_flash_alias():
    for path in TARGET_FILES:
        text = path.read_text(encoding="utf-8")
        assert "gemini-flash-latest" in text, f"{path.name} should use gemini-flash-latest"
        assert not VERSIONED_GEMINI_PATTERN.search(text), (
            f"{path.name} should not contain versioned Gemini model IDs"
        )


def test_router_agent_uses_gemini_image_tool():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    assert "from tools.gemini_image_generator import generate_image_tool" in text
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
