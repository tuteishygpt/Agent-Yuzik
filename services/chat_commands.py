from __future__ import annotations

import re

CLEAR_HISTORY_REPLY = "Гісторыя ачышчана. Пачынаем новую сесію."
CLEAR_HISTORY_COMMANDS = {
    "ачысці гісторыю",
    "ачысць гісторыю",
    "ачысці чат",
    "ачысць чат",
    "ачысці кантэкст",
    "ачысць кантэкст",
    "новая сесія",
    "пачні новую сесію",
    "пачаць новую сесію",
    "очисти историю",
    "очисть историю",
    "очисти чат",
    "очисть чат",
    "очисти контекст",
    "очисть контекст",
    "новая сессия",
    "начни новую сессию",
    "начать новую сессию",
}
POLITE_COMMAND_MARKERS = ("калі ласка", "пожалуйста", "please")


def normalize_chat_command(text: str) -> str:
    normalized = re.sub(r"[^\w\s]+", " ", text.casefold(), flags=re.UNICODE)
    return re.sub(r"\s+", " ", normalized).strip()


def strip_polite_command_marker(text: str) -> str:
    stripped = text
    changed = True
    while changed:
        changed = False
        for marker in POLITE_COMMAND_MARKERS:
            if stripped.startswith(f"{marker} "):
                stripped = stripped[len(marker) :].strip()
                changed = True
            if stripped.endswith(f" {marker}"):
                stripped = stripped[: -len(marker)].strip()
                changed = True
    return stripped


def is_clear_history_command(text: str) -> bool:
    command = strip_polite_command_marker(normalize_chat_command(text))
    return command in CLEAR_HISTORY_COMMANDS
