from google_search_agent.agent import search_agent
from meme_generator_agent.agent import meme_agent
import inspect

import router_agent.agent as router_module
from router_agent.agent import enable_minsk_time_mode, router_agent
from yuzik_workflow.intent_classifier import intent_classifier_agent
from yuzik_workflow.image_workflow import image_prompt_agent
from yuzik_workflow.root import create_yuzik_workflow
from yuzik_workflow.translation import (
    add_translation_context,
    clear_pending_translation,
    translation_agent,
)


class FakeRequest:
    def __init__(self):
        self.config = None
        self.contents = []
        self.instructions = []

    def append_instructions(self, instructions):
        self.instructions.extend(instructions)


class FakeContext:
    def __init__(self, state):
        self.state = state


def test_router_agent_route_first_tools_removed():
    tool_names = {getattr(tool, "name", "") for tool in router_agent.tools}

    assert "synthesize_speech" not in tool_names
    assert "generate_image" not in tool_names
    assert {"search_agent", "meme_agent", "get_weather", "lookup_verbum"} <= tool_names


def test_adk_agents_use_retry_enabled_gemini_models():
    agents = [
        router_agent,
        search_agent,
        meme_agent,
        image_prompt_agent,
        intent_classifier_agent,
        translation_agent,
    ]

    for agent in agents:
        assert agent.model.retry_options.attempts == 5
        assert agent.model.retry_options.http_status_codes == [
            408,
            429,
            500,
            502,
            503,
            504,
        ]


def test_router_instruction_does_not_call_removed_route_first_tools():
    assert "`synthesize_speech`" not in router_agent.instruction
    assert "`generate_image`" not in router_agent.instruction


def test_router_callback_appends_structured_previous_context():
    state = {
        "temp:turn_previous_text": "A previous assistant answer.",
        "temp:turn_previous_summary": None,
    }
    context = FakeContext(state)
    request = FakeRequest()

    enable_minsk_time_mode(context, request)

    assert any("previous_text" in instruction for instruction in request.instructions)
    assert any(
        "A previous assistant answer." in instruction
        for instruction in request.instructions
    )


def test_router_callback_appends_minsk_instruction_from_state():
    state = {"temp:minsk_time_enabled": True}
    context = FakeContext(state)
    request = FakeRequest()

    enable_minsk_time_mode(context, request)

    assert any("Europe/Minsk" in instruction for instruction in request.instructions)


def test_router_callback_appends_tts_instruction_from_state():
    state = {
        "temp:tts_requested": True,
        "temp:turn_previous_text": "Forecast text.",
    }
    context = FakeContext(state)
    request = FakeRequest()

    enable_minsk_time_mode(context, request)

    joined = "\n".join(request.instructions)
    assert "TTS has already been requested" in joined
    assert "Do not say that you cannot create audio" in joined
    assert "Forecast text." in joined


def test_router_agent_has_no_regex_intent_patterns():
    source = inspect.getsource(router_module)

    assert "TTS_REQUESTED_PATTERN" not in source
    assert "IMAGE_REQUESTED_PATTERN" not in source
    assert "TIME_RELATED_PATTERN" not in source
    assert "CREATION_CANCEL_PATTERN" not in source
    assert "re.compile" not in source


def test_image_route_runs_prompt_agent_before_generation_node():
    workflow = create_yuzik_workflow()
    edge_names = {
        (edge.from_node.name, edge.to_node.name)
        for edge in workflow.graph.edges
    }

    assert ("turn_context_node", "file_policy_node") in edge_names
    assert ("file_policy_node", "intent_classifier_agent") in edge_names
    assert ("intent_classifier_agent", "intent_policy_node") in edge_names
    assert ("intent_policy_node", "image_prompt_agent") in edge_names
    assert ("image_prompt_agent", "execute_image_workflow") in edge_names
    assert ("turn_context_node", "input_policy_node") not in edge_names
    assert ("intent_policy_node", "execute_image_workflow") not in edge_names


def test_translation_route_runs_translation_agent_before_postprocess():
    workflow = create_yuzik_workflow()
    edge_names = {
        (edge.from_node.name, edge.to_node.name)
        for edge in workflow.graph.edges
    }

    assert ("intent_policy_node", "translation_agent") in edge_names
    assert ("translation_agent", "translation_postprocess_node") in edge_names


def test_translation_callbacks_add_structured_context_and_clear_pending_state():
    state = {
        "temp:primary_route": "translation",
        "temp:translation_target_language": "en",
        "temp:translation_source_text": "translate the previous answer",
        "temp:turn_previous_text": "Прывітанне",
        "user:pending_text_action": {"kind": "translate", "target_language": "en"},
    }
    context = FakeContext(state)
    request = FakeRequest()

    add_translation_context(context, request)
    clear_pending_translation(context, object())

    assert '"current_text": "translate the previous answer"' in request.instructions[0]
    assert '"previous_text": "Прывітанне"' in request.instructions[0]
    assert state["user:pending_text_action"] is None
