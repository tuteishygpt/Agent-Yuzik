import logging


_NON_TEXT_USER = "[non-text input]"
_NON_TEXT_ASSISTANT = "[non-text response]"
_MAX_LOG_TEXT_LEN = 2000


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
