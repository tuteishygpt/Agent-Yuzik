import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config
from services.dialogue_logging import append_dialogue_turn, log_adk_turn


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_dialogue_log_paths_default_to_separate_files():
    assert config.CHAT_DIALOGUE_LOG_PATH == "chat_dialogues.txt"
    assert config.TEACHER_DIALOGUE_LOG_PATH == "teacher_dialogues.txt"


def test_log_adk_turn_logs_user_and_assistant_lines(caplog):
    logger = logging.getLogger("tests.adk.dialogue")

    with caplog.at_level(logging.INFO, logger=logger.name):
        log_adk_turn(logger, user_text=" Прывітанне\nсвет ", assistant_text="  Адказ   тут ")

    assert [record.getMessage() for record in caplog.records] == [
        "[ADK] USER: Прывітанне свет",
        "[ADK] ASSISTANT: Адказ тут",
    ]


def test_log_adk_turn_uses_non_text_placeholders(caplog):
    logger = logging.getLogger("tests.adk.dialogue.placeholder")

    with caplog.at_level(logging.INFO, logger=logger.name):
        log_adk_turn(logger, user_text="", assistant_text=None)

    assert [record.getMessage() for record in caplog.records] == [
        "[ADK] USER: [non-text input]",
        "[ADK] ASSISTANT: [non-text response]",
    ]


def test_append_dialogue_turn_writes_dialogues_txt_format(tmp_path):
    log_path = tmp_path / "chat_dialogues.txt"

    append_dialogue_turn(
        log_path,
        user_id="user-1",
        user_text=" Прывітанне\nсвет ",
        assistant_text="  Адказ   тут ",
        timestamp="2026-05-30 12:34:56",
    )

    assert log_path.read_text(encoding="utf-8") == (
        "[2026-05-30 12:34:56] USER (user-1): Прывітанне свет\n"
        "[2026-05-30 12:34:56] BOT: Адказ тут\n"
        "---\n"
    )


def test_append_dialogue_turn_prefers_user_label(tmp_path):
    log_path = tmp_path / "chat_dialogues.txt"

    append_dialogue_turn(
        log_path,
        user_id="user-1",
        user_label="person@example.com",
        user_text="hello",
        assistant_text="hi",
        timestamp="2026-05-30 12:34:56",
    )

    assert "[2026-05-30 12:34:56] USER (person@example.com): hello\n" in log_path.read_text(
        encoding="utf-8"
    )


def test_append_dialogue_turn_mirrors_normalized_turn_to_supabase_store(tmp_path):
    class FakeDialogueLogStore:
        def __init__(self):
            self.rows = []

        def append_turn(self, **kwargs):
            self.rows.append(kwargs)
            return kwargs

    store = FakeDialogueLogStore()
    log_path = tmp_path / "chat_dialogues.txt"

    append_dialogue_turn(
        log_path,
        user_id="telegram-123",
        user_label="@person",
        user_text=" hello\nworld ",
        assistant_text="  hi   there ",
        timestamp="2026-05-30 12:34:56",
        dialogue_log_store=store,
    )

    assert store.rows == [
        {
            "log_path": str(log_path),
            "source": "chat_dialogues",
            "user_id": "telegram-123",
            "user_label": "@person",
            "user_text": "hello world",
            "assistant_text": "hi there",
            "logged_at": "2026-05-30 12:34:56",
        }
    ]


def test_chat_and_bot_import_dialogue_logging_helper():
    chat_text = (REPO_ROOT / "api" / "chat.py").read_text(encoding="utf-8")
    bot_text = (REPO_ROOT / "bot" / "handlers.py").read_text(encoding="utf-8")
    chat_service_text = (REPO_ROOT / "services" / "chat_service.py").read_text(
        encoding="utf-8"
    )

    assert "CHAT_DIALOGUE_LOG_PATH" in chat_text
    assert '"dialogue_log_path": config.CHAT_DIALOGUE_LOG_PATH' in chat_text
    assert "from services.dialogue_logging import append_dialogue_turn, log_adk_turn" in chat_service_text
    assert "log_adk_turn(" in chat_service_text
    assert "append_dialogue_turn" in chat_service_text
    assert "from services.dialogue_logging import append_dialogue_turn, log_adk_turn" in bot_text
    assert "log_adk_turn(" in bot_text
    assert "append_dialogue_turn" in bot_text
