from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET_FILES = [
    REPO_ROOT / "config.py",
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
