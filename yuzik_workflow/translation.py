from __future__ import annotations

import json

import config
from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse

from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY


TARGET_LANGUAGE_NAMES = {
    "en": "English",
}


def add_translation_context(callback_context, llm_request: LlmRequest):
    target_language = callback_context.state.get("temp:translation_target_language", "en")
    target_name = TARGET_LANGUAGE_NAMES.get(target_language, target_language)
    source_text = callback_context.state.get("temp:translation_source_text", "")
    source_payload = {"current_text": source_text}
    previous_text = callback_context.state.get("temp:turn_previous_text")
    previous_summary = callback_context.state.get("temp:turn_previous_summary")
    if isinstance(previous_text, str) and previous_text.strip():
        source_payload["previous_text"] = previous_text.strip()
    if isinstance(previous_summary, str) and previous_summary.strip():
        source_payload["previous_summary"] = previous_summary.strip()

    llm_request.append_instructions(
        [
            (
                f"Translate to {target_name}. Return only the translation, with no "
                "explanation, commentary, quotes, or answer to the message content. "
                "The source data for this turn is this JSON object: "
                f"{json.dumps(source_payload, ensure_ascii=False)}. Translate "
                "current_text unless current_text clearly asks to translate prior "
                "assistant output; in that case translate previous_text, or "
                "previous_summary if previous_text is unavailable."
            )
        ]
    )
    return None


def clear_pending_translation(callback_context, llm_response: LlmResponse):
    _ = llm_response
    if callback_context.state.get("temp:primary_route") == "translation":
        callback_context.state[PENDING_TEXT_ACTION_KEY] = None
    return None


translation_agent = LlmAgent(
    name="translation_agent",
    model=config.create_adk_model(config.ROUTER_AGENT_MODEL),
    description="Dedicated text translation agent.",
    instruction=(
        "You are a translation-only agent. Translate the requested text exactly into "
        "the target language. Preserve meaning, tone, and paragraph structure. Do not "
        "answer, explain, summarize, or discuss the text."
    ),
    before_model_callback=add_translation_context,
    after_model_callback=clear_pending_translation,
)
