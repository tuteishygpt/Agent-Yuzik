import logging
from datetime import datetime
from pathlib import Path
from typing import Union


_NON_TEXT_USER = "[non-text input]"
_NON_TEXT_ASSISTANT = "[non-text response]"
_MAX_LOG_TEXT_LEN = 2000
_PathLike = Union[str, Path]


def _normalize_dialogue_text(text: str | None, *, placeholder: str) -> str:
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return placeholder
    return cleaned[:_MAX_LOG_TEXT_LEN]


def log_adk_turn(
    logger: logging.Logger,
    *,
    user_text: str | None,
    assistant_text: str | None,
) -> None:
    logger.info("[ADK] USER: %s", _normalize_dialogue_text(user_text, placeholder=_NON_TEXT_USER))
    logger.info(
        "[ADK] ASSISTANT: %s",
        _normalize_dialogue_text(assistant_text, placeholder=_NON_TEXT_ASSISTANT),
    )


def _format_timestamp(timestamp: datetime | str | None) -> str:
    if isinstance(timestamp, str):
        return timestamp
    return (timestamp or datetime.now()).strftime("%Y-%m-%d %H:%M:%S")


def append_dialogue_turn(
    log_path: _PathLike,
    *,
    user_id: str | None,
    user_label: str | None = None,
    user_text: str | None,
    assistant_text: str | None,
    timestamp: datetime | str | None = None,
    logger: logging.Logger | None = None,
) -> bool:
    """Append one dialogue turn using the legacy dialogues.txt format."""
    try:
        path = Path(log_path)
        if path.parent != Path("."):
            path.parent.mkdir(parents=True, exist_ok=True)

        ts = _format_timestamp(timestamp)
        normalized_user = _normalize_dialogue_text(user_text, placeholder=_NON_TEXT_USER)
        normalized_assistant = _normalize_dialogue_text(
            assistant_text,
            placeholder=_NON_TEXT_ASSISTANT,
        )
        resolved_user_id = _normalize_dialogue_text(
            user_label or user_id,
            placeholder="unknown",
        )

        with path.open("a", encoding="utf-8") as file:
            file.write(f"[{ts}] USER ({resolved_user_id}): {normalized_user}\n")
            file.write(f"[{ts}] BOT: {normalized_assistant}\n---\n")
        return True
    except Exception as exc:
        if logger is not None:
            logger.error("Failed to append dialogue log to %s: %s", log_path, exc)
        return False
