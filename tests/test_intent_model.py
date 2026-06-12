from yuzik_workflow.intent import TurnIntent, coerce_turn_intent
from google.genai import types


def test_coerce_turn_intent_defaults_invalid_route_to_default():
    intent = coerce_turn_intent({"route": "unknown", "actions": ["tts"]})

    assert intent.route == "default"
    assert intent.actions == ["tts"]


def test_coerce_turn_intent_drops_invalid_actions():
    intent = coerce_turn_intent({"route": "image", "actions": ["tts", "draw"]})

    assert intent.route == "image"
    assert intent.actions == ["tts"]


def test_coerce_turn_intent_clamps_confidence():
    high = coerce_turn_intent({"confidence": 2})
    low = coerce_turn_intent({"confidence": -1})

    assert high.confidence == 1.0
    assert low.confidence == 0.0


def test_coerce_turn_intent_allows_missing_target_language():
    intent = coerce_turn_intent({"route": "translation"})

    assert intent.target_language is None


def test_coerce_turn_intent_normalizes_previous_context_flag_to_boolean():
    intent = coerce_turn_intent({"needs_previous_context": "yes"})

    assert intent.needs_previous_context is True


def test_turn_intent_defaults_to_safe_route():
    intent = TurnIntent()

    assert intent.route == "default"
    assert intent.actions == []
    assert intent.confidence == 0.0


def test_coerce_turn_intent_parses_json_content_from_adk_output_schema():
    content = types.Content(
        role="model",
        parts=[
            types.Part(
                text='{"route": "default", "actions": ["tts"], '
                '"needs_previous_context": true, "confidence": 0.95}'
            )
        ],
    )

    intent = coerce_turn_intent(content)

    assert intent.route == "default"
    assert intent.actions == ["tts"]
    assert intent.needs_previous_context is True
    assert intent.confidence == 0.95
