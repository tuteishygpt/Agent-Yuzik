import asyncio
import inspect

from google.genai import types

import yuzik_workflow.policy as policy
from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY, intent_policy_node


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}
        self.route = None


def make_context(state=None):
    content = types.Content(role="user", parts=[types.Part(text="Hello")])
    base_state = {
        "temp:turn_current_text": "Hello",
        "temp:turn_current_content": content,
    }
    if state:
        base_state.update(state)
    return FakeContext(base_state), content


def test_intent_policy_routes_image_intent_to_image():
    ctx, content = make_context()

    result = asyncio.run(
        intent_policy_node(ctx, {"route": "image", "confidence": 0.9})
    )

    assert result is content
    assert ctx.route == "image"
    assert ctx.state["temp:turn_intent_route"] == "image"


def test_intent_policy_routes_translation_and_sets_translation_state():
    ctx, content = make_context({"temp:turn_current_text": "Translate this"})

    result = asyncio.run(
        intent_policy_node(
            ctx,
            {"route": "translation", "target_language": "en", "confidence": 0.9},
        )
    )

    assert result is content
    assert ctx.route == "translate"
    assert ctx.state["temp:primary_route"] == "translation"
    assert ctx.state["temp:translation_target_language"] == "en"
    assert ctx.state["temp:translation_source_text"] == "Translate this"


def test_intent_policy_sets_tts_action_state():
    ctx, _ = make_context({"temp:turn_current_text": "Агуч казку"})

    asyncio.run(
        intent_policy_node(
            ctx,
            {"route": "default", "actions": ["tts"], "confidence": 0.9},
        )
    )

    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["user:tts_requested_for_turn"] is True


def test_intent_policy_ignores_tts_action_without_explicit_audio_request():
    ctx, _ = make_context({"temp:turn_current_text": "раскажы казку"})

    asyncio.run(
        intent_policy_node(
            ctx,
            {"route": "default", "actions": ["tts"], "confidence": 0.9},
        )
    )

    assert ctx.route == "default"
    assert ctx.state["temp:tts_requested"] is False
    assert ctx.state["user:tts_requested_for_turn"] is False


def test_intent_policy_removes_previous_context_for_self_contained_news_tts_request():
    ctx, _ = make_context(
        {
            "temp:turn_current_text": "пашукай навіны і агуч",
            "temp:turn_previous_text": "Папярэдняя казка пра коніка.",
            "temp:turn_previous_summary": "Казка пра коніка.",
        }
    )

    asyncio.run(
        intent_policy_node(
            ctx,
            {
                "route": "default",
                "actions": ["tts"],
                "needs_previous_context": True,
                "confidence": 0.9,
            },
        )
    )

    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["temp:turn_previous_text"] is None
    assert ctx.state["temp:turn_previous_summary"] is None


def test_intent_policy_keeps_previous_context_for_explicit_anaphora_tts_request():
    ctx, _ = make_context(
        {
            "temp:turn_current_text": "агуч яго",
            "temp:turn_previous_text": "Папярэдні адказ.",
        }
    )

    asyncio.run(
        intent_policy_node(
            ctx,
            {
                "route": "default",
                "actions": ["tts"],
                "needs_previous_context": True,
                "confidence": 0.9,
            },
        )
    )

    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["temp:turn_previous_text"] == "Папярэдні адказ."


def test_intent_policy_sets_minsk_timezone_state():
    ctx, _ = make_context()

    asyncio.run(
        intent_policy_node(
            ctx,
            {"route": "default", "timezone": "Europe/Minsk", "confidence": 0.9},
        )
    )

    assert ctx.state["temp:minsk_time_enabled"] is True
    assert ctx.state["temp:timezone"] == "Europe/Minsk"


def test_intent_policy_cancel_clears_pending_text_action():
    ctx, _ = make_context(
        {PENDING_TEXT_ACTION_KEY: {"kind": "translate", "target_language": "en"}}
    )

    asyncio.run(intent_policy_node(ctx, {"route": "cancel", "confidence": 0.9}))

    assert ctx.route == "cancel"
    assert ctx.state[PENDING_TEXT_ACTION_KEY] is None


def test_intent_policy_low_confidence_uses_default_and_ignores_actions():
    ctx, _ = make_context()

    asyncio.run(
        intent_policy_node(
            ctx,
            {
                "route": "image",
                "actions": ["tts"],
                "timezone": "Europe/Minsk",
                "confidence": 0.2,
            },
        )
    )

    assert ctx.route == "default"
    assert ctx.state["temp:tts_requested"] is False
    assert ctx.state["user:tts_requested_for_turn"] is False
    assert ctx.state["temp:minsk_time_enabled"] is False
    assert ctx.state["temp:timezone"] is None


def test_pending_translation_state_routes_next_text_to_translation():
    ctx, _ = make_context(
        {
            PENDING_TEXT_ACTION_KEY: {
                "kind": "translate",
                "target_language": "en",
            },
            "temp:turn_current_text": "Source text",
        }
    )

    asyncio.run(intent_policy_node(ctx, {"route": "default", "confidence": 0.9}))

    assert ctx.route == "translate"
    assert ctx.state["temp:translation_target_language"] == "en"
    assert ctx.state["temp:translation_source_text"] == "Source text"


def test_policy_does_not_import_or_compile_regex():
    source = inspect.getsource(policy)

    assert "import re" not in source
    assert "re.compile" not in source
    assert "_PATTERN" not in source
