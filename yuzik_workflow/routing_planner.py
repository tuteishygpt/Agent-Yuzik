from __future__ import annotations

import json
from typing import Any, Mapping

import config
from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest

from yuzik_workflow.routing_plan import RoutingPlan


MAX_CONTEXT_STRING_CHARS = 1200
MAX_CONTEXT_LIST_ITEMS = 6

ROUTING_PLANNER_INSTRUCTION = """
You are the Yuzik Workflow V2 routing planner.
Return only the structured schema.
Do not answer the user.

Choose one route:
- chat: ordinary assistant response through the chat route.
- search: current or web-backed information is needed.
- weather: weather forecast or current weather request.
- dictionary: dictionary lookup for a word or phrase.
- image: user wants a generated image, including a follow-up image from prior text.
- translate: translate current or referenced text.
- direct: deterministic clarification or status response, not a content answer.
- cancel: user cancels a pending action.

Context references:
- target_text_ref=current_text for the latest user text.
- target_text_ref=previous_assistant_text for follow-ups like "Read it aloud",
  "translate it", or "draw an image based on that" when prior answer text exists.
- target_text_ref=rolling_summary when only summary context is available.
- target_text_ref=artifact when the request refers to a prior artifact.
- target_text_ref=none for cancel or pure clarification.

Tools:
- Set tools to the deterministic tool family needed by the route, such as
  search, weather, dictionary, image_generation, or translation.
- Set post_actions=["tts"] only when the user asks for audio/read-aloud.
- Treat every wording whose meaning is "make this spoken/audio" as a TTS
  request, including "\u0430\u0433\u0443\u0447", "\u0430\u0433\u0443\u0447\u044b",
  "\u0430\u0433\u0443\u0447\u044b\u0446\u044c",
  "\u043f\u0440\u0430\u0447\u044b\u0442\u0430\u0439 \u0443\u0433\u043e\u043b\u0430\u0441",
  "\u0437\u0440\u0430\u0431\u0456 \u0430\u045e\u0434\u044b\u044f",
  "\u0433\u043e\u043b\u0430\u0441\u0430\u043c",
  "\u043e\u0437\u0432\u0443\u0447\u044c", read aloud, voice, audio, or TTS.
- For search, set pending_action_update.query to the final web search query
  when the query is selected, rewritten, or derived from referenced context.
- For weather, set pending_action_update.city when the current text names a
  city, including short follow-ups like "and in Lida?", "\u0430 \u045e \u041b\u0456\u0434\u0437\u0435?",
  or "\u041b\u0456\u0434\u0430!". If no city is named, omit city so Minsk remains the default.
- Use pending_action_update for route-specific details such as dictionary_word,
  target_language, sources, or clearing a pending action.
- Keep rationale short. It is for diagnostics, not the user.

Examples:
- current_text="Hello" -> route=chat, target_text_ref=current_text.
- current_text="Read it aloud" with previous_assistant_text -> route=chat,
  post_actions=["tts"], needs_previous_context=true,
  target_text_ref=previous_assistant_text.
- current_text="draw an image based on that" with previous_assistant_text ->
  route=image, tools=["image_generation"], needs_previous_context=true,
  target_text_ref=previous_assistant_text.
- current_text asks for weather in Minsk -> route=weather, tools=["weather"],
  pending_action_update.city="Minsk".
- current_text="\u0430 \u045e \u041b\u0456\u0434\u0437\u0435?" after a weather answer -> route=weather,
  tools=["weather"], pending_action_update.city="\u041b\u0456\u0434\u0430".
- current_text asks to look up a word in a dictionary -> route=dictionary,
  tools=["dictionary"].
- current_text asks for latest/current facts -> route=search, tools=["search"],
  pending_action_update.query=<final web query>.
- current_text="search more about that" with previous_assistant_text ->
  route=search, tools=["search"], target_text_ref=previous_assistant_text,
  pending_action_update.query=<query derived from previous_assistant_text>.
- current_text asks to translate this or the previous answer -> route=translate,
  tools=["translation"], target_text_ref=current_text or previous_assistant_text.
- current_text cancels/stops a pending request -> route=cancel,
  target_text_ref=none.
"""


def _state_text(state: Mapping[str, Any], key: str) -> str | None:
    value = state.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _compact_value(value: Any) -> Any:
    if isinstance(value, str):
        return value[:MAX_CONTEXT_STRING_CHARS]
    if isinstance(value, Mapping):
        return {
            str(key): _compact_value(item)
            for key, item in value.items()
            if item is not None and item != ""
        }
    if isinstance(value, list):
        return [_compact_value(item) for item in value[:MAX_CONTEXT_LIST_ITEMS]]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)[:MAX_CONTEXT_STRING_CHARS]


def _context_pack_from_state(state: Mapping[str, Any]) -> dict[str, Any]:
    existing = state.get("temp:conversation_context_pack")
    if isinstance(existing, Mapping):
        return dict(_compact_value(existing))

    payload: dict[str, Any] = {
        "current_text": _state_text(state, "temp:turn_current_text"),
        "language": _state_text(state, "temp:turn_language"),
    }
    previous_text = _state_text(state, "temp:turn_previous_text")
    previous_summary = _state_text(state, "temp:turn_previous_summary")
    previous_artifact_id = _state_text(state, "temp:turn_previous_artifact_id")
    if previous_text:
        payload["previous_assistant_text"] = previous_text
    if previous_summary:
        payload["previous_assistant_summary"] = previous_summary
    if previous_artifact_id:
        payload["previous_artifact_id"] = previous_artifact_id
    return {key: value for key, value in payload.items() if value is not None}


def add_routing_context(callback_context, llm_request: LlmRequest):
    context_pack = _context_pack_from_state(callback_context.state)
    llm_request.append_instructions(
        [
            (
                "Plan this workflow turn using this compact ContextPack JSON: "
                f"{json.dumps(context_pack, ensure_ascii=False)}"
            )
        ]
    )
    return None


routing_planner_agent = LlmAgent(
    name="routing_planner_agent",
    model=config.create_adk_model(config.ROUTER_AGENT_MODEL),
    instruction=ROUTING_PLANNER_INSTRUCTION,
    output_schema=RoutingPlan,
    tools=[],
    before_model_callback=add_routing_context,
)
