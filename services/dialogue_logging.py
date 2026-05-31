import logging
from datetime import datetime
from pathlib import Path
from typing import Protocol, Union


_NON_TEXT_USER = "[non-text input]"
_NON_TEXT_ASSISTANT = "[non-text response]"
_MAX_LOG_TEXT_LEN = 2000
_PathLike = Union[str, Path]


class _DialogueLogStore(Protocol):
    def append_turn(
        self,
        *,
        log_path: str,
        source: str,
        user_id: str,
        user_label: str | None,
        user_text: str,
        assistant_text: str,
        logged_at: str,
    ) -> dict:
        ...


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


def _dialogue_log_source(log_path: _PathLike) -> str:
    return Path(log_path).stem or "dialogue"


def _default_dialogue_log_store() -> _DialogueLogStore | None:
    import config

    if not config.has_supabase_service_role_config():
        return None

    from services.supabase.dialogue_log_store import DialogueLogStore

    return DialogueLogStore()


def append_dialogue_turn(
    log_path: _PathLike,
    *,
    user_id: str | None,
    user_label: str | None = None,
    user_text: str | None,
    assistant_text: str | None,
    timestamp: datetime | str | None = None,
    logger: logging.Logger | None = None,
    dialogue_log_store: _DialogueLogStore | None = None,
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
    except Exception as exc:
        if logger is not None:
            logger.error("Failed to append dialogue log to %s: %s", log_path, exc)
        return False

    try:
        store = dialogue_log_store or _default_dialogue_log_store()
        if store is not None:
            store.append_turn(
                log_path=str(log_path),
                source=_dialogue_log_source(log_path),
                user_id=user_id or "unknown",
                user_label=user_label,
                user_text=normalized_user,
                assistant_text=normalized_assistant,
                logged_at=ts,
            )
    except Exception as exc:
        if logger is not None:
            logger.error("Failed to mirror dialogue log to Supabase: %s", exc)

    return True
