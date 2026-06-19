import asyncio

from google.genai import types

from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY
from yuzik_workflow.route_executor import route_executor_node, search_query_node


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}
        self.route = None


def make_context(state=None):
    content = types.Content(role="user", parts=[types.Part(text="Hello")])
    base_state = {
        "temp:turn_current_text": "Hello",
        "temp:turn_current_content": content,
        "temp:turn_previous_text": "Previous answer",
        "temp:turn_previous_summary": "Previous summary",
        "temp:conversation_context_pack": {
            "current_text": "Hello",
            "previous_assistant_text": "Previous answer",
        },
    }
    if state:
        base_state.update(state)
    return FakeContext(base_state), content


def test_route_executor_low_confidence_falls_back_to_chat():
    ctx, content = make_context()

    result = asyncio.run(
        route_executor_node(ctx, {"route": "image", "confidence": 0.2})
    )

    assert result is content
    assert ctx.route == "chat"
    assert ctx.state["temp:primary_route"] == "chat"
    assert ctx.state["temp:routing_diagnostics"]["fallback_reason"] == "low_confidence"


def test_route_executor_dictionary_missing_word_asks_directly_and_sets_pending_action():
    ctx, _ = make_context({"temp:turn_current_text": "lookup in dictionary"})

    result = asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "dictionary",
                "confidence": 0.95,
                "pending_action_update": {"sources": ["slounik"]},
            },
        )
    )

    assert ctx.route == "direct"
    assert ctx.state[PENDING_TEXT_ACTION_KEY] == {
        "kind": "dictionary",
        "sources": ["slounik"],
        "slounik_dicts": [],
    }
    assert result.parts[0].text
    assert ctx.state["temp:routing_diagnostics"]["fallback_reason"] == "missing_dictionary_word"


def test_route_executor_dictionary_with_word_routes_to_dictionary_node():
    ctx, content = make_context()

    result = asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "dictionary",
                "confidence": 0.95,
                "pending_action_update": {"dictionary_word": "востраў"},
            },
        )
    )

    assert result is content
    assert ctx.route == "dictionary"
    assert ctx.state["temp:primary_route"] == "dictionary"
    assert ctx.state["temp:dictionary_word"] == "востраў"


def test_route_executor_pending_dictionary_uses_current_text_as_word():
    ctx, content = make_context(
        {
            PENDING_TEXT_ACTION_KEY: {
                "kind": "dictionary",
                "sources": ["verbum"],
                "slounik_dicts": [],
            },
            "temp:turn_current_text": "\u0441\u043f\u0440\u0430\u0432\u0430",
        }
    )

    result = asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "dictionary",
                "confidence": 0.95,
                "pending_action_update": {},
            },
        )
    )

    assert result is content
    assert ctx.route == "dictionary"
    assert ctx.state[PENDING_TEXT_ACTION_KEY] is None
    assert ctx.state["temp:primary_route"] == "dictionary"
    assert ctx.state["temp:dictionary_word"] == "\u0441\u043f\u0440\u0430\u0432\u0430"
    assert ctx.state["temp:dictionary_sources"] == ["verbum"]


def test_route_executor_pending_dictionary_overrides_low_confidence_plan():
    ctx, _ = make_context(
        {
            PENDING_TEXT_ACTION_KEY: {
                "kind": "dictionary",
                "sources": ["verbum"],
                "slounik_dicts": [],
            },
            "temp:turn_current_text": "\u0441\u043f\u0440\u0430\u0432\u0430",
        }
    )

    asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "chat",
                "confidence": 0.2,
            },
        )
    )

    assert ctx.route == "dictionary"
    assert ctx.state[PENDING_TEXT_ACTION_KEY] is None
    assert ctx.state["temp:dictionary_word"] == "\u0441\u043f\u0440\u0430\u0432\u0430"


def test_route_executor_translate_uses_previous_text_reference():
    ctx, content = make_context({"temp:turn_current_text": "translate it"})

    result = asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "translate",
                "target_text_ref": "previous_assistant_text",
                "confidence": 0.95,
                "pending_action_update": {"target_language": "en"},
            },
        )
    )

    assert result is content
    assert ctx.route == "translate"
    assert ctx.state["temp:primary_route"] == "translation"
    assert ctx.state["temp:translation_target_language"] == "en"
    assert ctx.state["temp:translation_source_text"] == "Previous answer"


def test_route_executor_image_routes_to_prompt_agent_and_skips_tts_request():
    ctx, content = make_context()

    result = asyncio.run(
        route_executor_node(
            ctx,
            {"route": "image", "post_actions": ["tts"], "confidence": 0.95},
        )
    )

    assert result is content
    assert ctx.route == "image"
    assert ctx.state["temp:primary_route"] == "image"
    assert ctx.state["temp:tts_requested"] is False
    assert ctx.state["temp:routing_diagnostics"]["tts_skipped_for_image"] is True


def test_route_executor_chat_tts_sets_post_action_state():
    ctx, content = make_context({"temp:turn_current_text": "read it aloud"})

    result = asyncio.run(
        route_executor_node(
            ctx,
            {"route": "chat", "post_actions": ["tts"], "confidence": 0.95},
        )
    )

    assert result is content
    assert ctx.route == "chat"
    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["user:tts_requested_for_turn"] is True


def test_route_executor_low_confidence_tts_plan_preserves_post_action_state():
    ctx, content = make_context({"temp:turn_current_text": "\u0430\u0433\u0443\u0447"})

    result = asyncio.run(
        route_executor_node(
            ctx,
            {"route": "chat", "post_actions": ["tts"]},
        )
    )

    assert result is content
    assert ctx.route == "chat"
    assert ctx.state["temp:primary_route"] == "chat"
    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["user:tts_requested_for_turn"] is True
    assert ctx.state["temp:routing_diagnostics"]["fallback_reason"] == "low_confidence"


def test_route_executor_explicit_tts_text_overrides_direct_clarification():
    ctx, content = make_context(
        {"temp:turn_current_text": "\u0430\u0433\u0443\u0447 \u0442\u044d\u043a\u0441\u0442 \u043f\u0440\u0430 \u0437\u0443\u0431\u0440\u0430"}
    )

    result = asyncio.run(
        route_executor_node(
            ctx,
            {"route": "direct", "confidence": 0.95},
        )
    )

    assert result is content
    assert ctx.route == "chat"
    assert ctx.state["temp:primary_route"] == "chat"
    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["user:tts_requested_for_turn"] is True


def test_route_executor_explicit_tts_ignores_pending_dictionary_action():
    ctx, content = make_context(
        {
            PENDING_TEXT_ACTION_KEY: {
                "kind": "dictionary",
                "sources": ["verbum"],
                "slounik_dicts": [],
            },
            "temp:turn_current_text": "\u043f\u0440\u0430\u0447\u044b\u0442\u0430\u0439 \u0443\u0433\u043e\u043b\u0430\u0441",
        }
    )

    result = asyncio.run(
        route_executor_node(
            ctx,
            {"route": "chat", "confidence": 0.2},
        )
    )

    assert result is content
    assert ctx.route == "chat"
    assert ctx.state[PENDING_TEXT_ACTION_KEY] is None
    assert ctx.state["temp:tts_requested"] is True
    assert ctx.state["user:tts_requested_for_turn"] is True


def test_route_executor_cancel_clears_pending_action_and_skips_post_actions():
    ctx, _ = make_context(
        {PENDING_TEXT_ACTION_KEY: {"kind": "translate", "target_language": "en"}}
    )

    result = asyncio.run(
        route_executor_node(
            ctx,
            {"route": "cancel", "post_actions": ["tts"], "confidence": 0.95},
        )
    )

    assert result.role == "model"
    assert ctx.route == "cancel"
    assert ctx.state[PENDING_TEXT_ACTION_KEY] is None
    assert ctx.state["temp:creation_cancelled"] is True
    assert ctx.state["temp:tts_requested"] is False


def test_route_executor_direct_returns_model_clarification_not_user_echo():
    ctx, _ = make_context({"temp:turn_current_text": "what do you mean?"})

    result = asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "direct",
                "confidence": 0.95,
                "pending_action_update": {"direct_answer": "Please clarify."},
            },
        )
    )

    assert ctx.route == "direct"
    assert result.role == "model"
    assert result.parts[0].text == "Please clarify."


def test_route_executor_cancel_returns_model_confirmation_not_user_echo():
    ctx, _ = make_context({"temp:turn_current_text": "cancel"})

    result = asyncio.run(
        route_executor_node(ctx, {"route": "cancel", "confidence": 0.95})
    )

    assert ctx.route == "cancel"
    assert result.role == "model"
    assert result.parts[0].text
    assert result.parts[0].text != "cancel"


def test_route_executor_weather_sets_deterministic_weather_branch():
    ctx, content = make_context({"temp:turn_current_text": "weather in Minsk"})

    result = asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "weather",
                "confidence": 0.95,
                "pending_action_update": {"city": "Minsk", "forecast_days": 2},
            },
        )
    )

    assert result is content
    assert ctx.route == "weather"
    assert ctx.state["temp:primary_route"] == "weather"
    assert ctx.state["temp:weather_city"] == "Minsk"
    assert ctx.state["temp:weather_forecast_days"] == 2


def test_route_executor_search_sets_search_branch_with_query():
    ctx, content = make_context({"temp:turn_current_text": "latest news"})

    result = asyncio.run(
        route_executor_node(ctx, {"route": "search", "confidence": 0.95})
    )

    assert result is content
    assert ctx.route == "search"
    assert ctx.state["temp:primary_route"] == "search"
    assert ctx.state["temp:search_query"] == "latest news"


def test_search_query_node_passes_planner_query_to_search_agent_input():
    ctx, original_content = make_context({"temp:turn_current_text": "search it"})

    asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "search",
                "confidence": 0.95,
                "pending_action_update": {"query": "Belarus latest economy"},
            },
        )
    )
    result = asyncio.run(search_query_node(ctx, original_content))

    assert result.role == "user"
    assert result.parts[0].text == "Belarus latest economy"
    assert result.parts[0].text != "search it"


def test_search_query_node_passes_planner_selected_context_to_search_agent_input():
    ctx, original_content = make_context(
        {
            "temp:turn_current_text": "search more about that",
            "temp:turn_previous_text": "Belarus economy forecast",
        }
    )

    asyncio.run(
        route_executor_node(
            ctx,
            {
                "route": "search",
                "confidence": 0.95,
                "target_text_ref": "previous_assistant_text",
            },
        )
    )
    result = asyncio.run(search_query_node(ctx, original_content))

    assert result.role == "user"
    assert result.parts[0].text == "Belarus economy forecast"
    assert result.parts[0].text != "search more about that"


def test_search_query_node_keeps_original_input_without_search_query():
    ctx, original_content = make_context({"temp:turn_current_text": "search it"})

    result = asyncio.run(search_query_node(ctx, original_content))

    assert result is original_content
