from dataclasses import dataclass

from google.genai import types

from yuzik_workflow.routing_plan import RoutingPlan, coerce_routing_plan


@dataclass
class DataclassPlan:
    route: str = "weather"
    confidence: float = 0.8
    rationale: str = "weather request"


class ModelDumpPlan:
    def model_dump(self):
        return {
            "route": "dictionary",
            "tools": ["dictionary", "invalid"],
            "post_actions": ["tts", "draw"],
            "confidence": 2,
            "rationale": "dictionary lookup",
        }


def test_routing_plan_defaults_to_safe_chat_route():
    plan = RoutingPlan()

    assert plan.route == "chat"
    assert plan.needs_previous_context is False
    assert plan.target_text_ref == "current_text"
    assert plan.artifact_ref is None
    assert plan.tools == []
    assert plan.post_actions == []
    assert plan.pending_action_update is None
    assert plan.answer_style == "normal"
    assert plan.confidence == 0.0
    assert plan.rationale


def test_coerce_routing_plan_accepts_chat_mapping():
    plan = coerce_routing_plan(
        {
            "route": "chat",
            "confidence": 0.75,
            "rationale": "general answer",
        }
    )

    assert plan.route == "chat"
    assert plan.confidence == 0.75
    assert plan.rationale == "general answer"


def test_coerce_routing_plan_accepts_follow_up_tts():
    plan = coerce_routing_plan(
        {
            "route": "chat",
            "needs_previous_context": True,
            "target_text_ref": "previous_assistant_text",
            "post_actions": ["tts"],
            "confidence": 0.95,
            "rationale": "read previous answer aloud",
        }
    )

    assert plan.route == "chat"
    assert plan.needs_previous_context is True
    assert plan.target_text_ref == "previous_assistant_text"
    assert plan.post_actions == ["tts"]


def test_coerce_routing_plan_accepts_previous_answer_image():
    plan = coerce_routing_plan(
        {
            "route": "image",
            "needs_previous_context": True,
            "target_text_ref": "previous_assistant_text",
            "tools": ["image_generation"],
            "confidence": 0.9,
        }
    )

    assert plan.route == "image"
    assert plan.needs_previous_context is True
    assert plan.target_text_ref == "previous_assistant_text"
    assert plan.tools == ["image_generation"]


def test_coerce_routing_plan_accepts_weather_dictionary_search_translation_cancel():
    weather = coerce_routing_plan({"route": "weather", "tools": ["weather"]})
    dictionary = coerce_routing_plan(
        {"route": "dictionary", "pending_action_update": {"dictionary_word": "дом"}}
    )
    search = coerce_routing_plan({"route": "search", "tools": ["search"]})
    translate = coerce_routing_plan(
        {
            "route": "translate",
            "target_text_ref": "current_text",
            "pending_action_update": {"target_language": "en"},
        }
    )
    cancel = coerce_routing_plan({"route": "cancel", "post_actions": ["tts"]})

    assert weather.route == "weather"
    assert dictionary.route == "dictionary"
    assert dictionary.pending_action_update == {"dictionary_word": "дом"}
    assert search.route == "search"
    assert translate.route == "translate"
    assert translate.pending_action_update == {"target_language": "en"}
    assert cancel.route == "cancel"
    assert cancel.post_actions == ["tts"]


def test_coerce_routing_plan_falls_back_to_chat_for_invalid_route():
    plan = coerce_routing_plan({"route": "unknown", "confidence": 0.95})

    assert plan.route == "chat"
    assert plan.confidence == 0.0
    assert "fallback" in plan.rationale.lower()


def test_coerce_routing_plan_clamps_confidence_and_filters_lists():
    high = coerce_routing_plan(ModelDumpPlan())
    low = coerce_routing_plan(
        {
            "route": "search",
            "tools": ["search", "shell", "", 7],
            "post_actions": ["tts", "email"],
            "confidence": -1,
        }
    )

    assert high.route == "dictionary"
    assert high.tools == ["dictionary"]
    assert high.post_actions == ["tts"]
    assert high.confidence == 1.0
    assert low.tools == ["search"]
    assert low.post_actions == ["tts"]
    assert low.confidence == 0.0


def test_coerce_routing_plan_accepts_dataclass_model_and_json_content():
    dataclass_plan = coerce_routing_plan(DataclassPlan())
    content = types.Content(
        role="model",
        parts=[
            types.Part(
                text=(
                    '{"route": "direct", "answer_style": "brief", '
                    '"confidence": 0.6, "rationale": "clarify"}'
                )
            )
        ],
    )
    content_plan = coerce_routing_plan(content)

    assert dataclass_plan.route == "weather"
    assert dataclass_plan.confidence == 0.8
    assert content_plan.route == "direct"
    assert content_plan.answer_style == "brief"


def test_coerce_routing_plan_falls_back_to_chat_for_invalid_json_content():
    content = types.Content(role="model", parts=[types.Part(text="not json")])

    plan = coerce_routing_plan(content)

    assert plan.route == "chat"
    assert plan.confidence == 0.0
    assert "fallback" in plan.rationale.lower()
