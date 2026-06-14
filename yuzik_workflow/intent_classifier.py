from __future__ import annotations

import json

import config
from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest

from yuzik_workflow.intent import TurnIntent


INTENT_CLASSIFIER_INSTRUCTION = """
You classify the latest user turn for the Yuzik workflow.
Return only the structured schema.
Do not answer the user.

Routes:
- default: normal text/tool answer by router_agent
- image: user wants an image generated
- translation: user wants text translated
- dictionary: user wants to look up a word in a dictionary such as Verbum or Slounik.org
- direct: workflow should answer directly without router_agent
- cancel: user cancels a pending generation/action

Actions:
- tts: user wants the final answer or referenced text synthesized as audio

Use timezone="Europe/Minsk" when the user asks for current time/date context in Minsk.
Use needs_previous_context=true only when the latest turn needs previous_text or previous_summary.
For dictionary route:
- Set dictionary_word when the word to look up is present.
- Set needs_dictionary_word=true when the user asks to search a dictionary but does not provide the word.
- Set dictionary_sources=["verbum"] or ["slounik"] only when the user explicitly names one source; otherwise leave it empty to search all default dictionaries.

Examples:
- current_text="знайдзі слова ў слоўніку" -> {"route": "dictionary", "needs_dictionary_word": true, "confidence": 0.95}
- current_text="знайдзі ў слоўніку востраў" -> {"route": "dictionary", "dictionary_word": "востраў", "confidence": 0.95}
- current_text="знайдзі ў slounik.org востраў" -> {"route": "dictionary", "dictionary_word": "востраў", "dictionary_sources": ["slounik"], "confidence": 0.95}
- current_text="Агуч яго" with previous_text present -> {"route": "default", "actions": ["tts"], "needs_previous_context": true, "confidence": 0.95}
- current_text="Агуч гэта" with previous_text present -> {"route": "default", "actions": ["tts"], "needs_previous_context": true, "confidence": 0.95}
- current_text="Read it aloud" with previous_text present -> {"route": "default", "actions": ["tts"], "needs_previous_context": true, "confidence": 0.95}
- current_text="Прыдумай і агуч казку" -> {"route": "default", "actions": ["tts"], "needs_previous_context": false, "confidence": 0.95}
- current_text="Зрабі малюнак па ёй" with previous_text present -> {"route": "image", "actions": [], "needs_previous_context": true, "confidence": 0.95}
"""


def _state_text(state, key: str) -> str | None:
    value = state.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def add_intent_classifier_context(callback_context, llm_request: LlmRequest):
    state = callback_context.state
    payload = {
        "current_text": _state_text(state, "temp:turn_current_text"),
        "language": _state_text(state, "temp:turn_language"),
        "has_file_parts": bool(state.get("temp:turn_has_file_parts")),
    }

    previous_text = _state_text(state, "temp:turn_previous_text")
    previous_summary = _state_text(state, "temp:turn_previous_summary")
    previous_artifact_id = _state_text(state, "temp:turn_previous_artifact_id")
    if previous_text:
        payload["previous_text"] = previous_text
    if previous_summary:
        payload["previous_summary"] = previous_summary
    if previous_artifact_id:
        payload["previous_artifact_id"] = previous_artifact_id

    llm_request.append_instructions(
        [
            (
                "Classify this workflow turn using this JSON context: "
                f"{json.dumps(payload, ensure_ascii=False)}"
            )
        ]
    )
    return None


intent_classifier_agent = LlmAgent(
    name="intent_classifier_agent",
    model=config.create_adk_model(config.ROUTER_AGENT_MODEL),
    instruction=INTENT_CLASSIFIER_INSTRUCTION,
    output_schema=TurnIntent,
    tools=[],
    before_model_callback=add_intent_classifier_context,
)
