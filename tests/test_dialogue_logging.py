import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.dialogue_logging import log_adk_turn


REPO_ROOT = Path(__file__).resolve().parents[1]


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


def test_chat_and_bot_import_dialogue_logging_helper():
    chat_text = (REPO_ROOT / "api" / "chat.py").read_text(encoding="utf-8")
    bot_text = (REPO_ROOT / "bot" / "handlers.py").read_text(encoding="utf-8")

    assert "from services.dialogue_logging import log_adk_turn" in chat_text
    assert "log_adk_turn(" in chat_text
    assert "from services.dialogue_logging import log_adk_turn" in bot_text
    assert "log_adk_turn(" in bot_text
