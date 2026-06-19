import json

from yuzik_workflow.routing_plan import RoutingPlan
from yuzik_workflow.routing_planner import (
    ROUTING_PLANNER_INSTRUCTION,
    add_routing_context,
    routing_planner_agent,
)


class FakeRequest:
    def __init__(self):
        self.instructions = []

    def append_instructions(self, instructions):
        self.instructions.extend(instructions)


class FakeContext:
    def __init__(self, state):
        self.state = state


def test_routing_planner_agent_uses_structured_schema_without_tools():
    assert routing_planner_agent.name == "routing_planner_agent"
    assert routing_planner_agent.output_schema is RoutingPlan
    assert routing_planner_agent.tools == []


def test_routing_planner_instruction_documents_routes_and_no_answering():
    instruction = ROUTING_PLANNER_INSTRUCTION

    assert "Do not answer the user" in instruction
    for route in (
        "chat",
        "search",
        "weather",
        "dictionary",
        "image",
        "translate",
        "direct",
        "cancel",
    ):
        assert route in instruction
    assert "target_text_ref" in instruction
    assert "post_actions" in instruction
    assert "rationale" in instruction


def test_routing_planner_instruction_covers_required_example_intents():
    instruction = ROUTING_PLANNER_INSTRUCTION

    assert "Read it aloud" in instruction
    assert "previous_assistant_text" in instruction
    assert "draw an image" in instruction
    assert "weather" in instruction
    assert "dictionary" in instruction
    assert "search" in instruction
    assert "pending_action_update.query" in instruction
    assert "translate" in instruction
    assert "cancel" in instruction


def test_routing_planner_instruction_covers_tts_synonyms():
    instruction = ROUTING_PLANNER_INSTRUCTION

    for phrase in (
        "\u0430\u0433\u0443\u0447",
        "\u0430\u0433\u0443\u0447\u044b",
        "\u0430\u0433\u0443\u0447\u044b\u0446\u044c",
        "\u043f\u0440\u0430\u0447\u044b\u0442\u0430\u0439 \u0443\u0433\u043e\u043b\u0430\u0441",
        "\u0437\u0440\u0430\u0431\u0456 \u0430\u045e\u0434\u044b\u044f",
        "\u0433\u043e\u043b\u0430\u0441\u0430\u043c",
        "\u043e\u0437\u0432\u0443\u0447\u044c",
        "read aloud",
        "voice",
    ):
        assert phrase in instruction


def test_add_routing_context_appends_compact_context_pack_json_from_state():
    request = FakeRequest()
    context_pack = {
        "current_text": "Read it aloud",
        "language": "en",
        "previous_assistant_text": "A previous answer.",
        "rolling_summary": "Earlier summary.",
        "recent_messages": [
            {"role": "user", "text": "hello"},
            {"role": "assistant", "text": "A previous answer."},
        ],
    }
    context = FakeContext({"temp:conversation_context_pack": context_pack})

    add_routing_context(context, request)

    assert request.instructions
    prompt = request.instructions[0]
    assert "ContextPack JSON" in prompt
    assert '"current_text": "Read it aloud"' in prompt
    assert '"previous_assistant_text": "A previous answer."' in prompt
    payload = json.loads(prompt.split("ContextPack JSON: ", 1)[1])
    assert payload["current_text"] == "Read it aloud"
    assert payload["recent_messages"][0]["role"] == "user"


def test_add_routing_context_builds_minimal_payload_when_context_pack_missing():
    request = FakeRequest()
    context = FakeContext(
        {
            "temp:turn_current_text": "What is the weather in Minsk?",
            "temp:turn_language": "en",
            "temp:turn_previous_text": "Previous answer.",
            "temp:turn_previous_summary": "Previous summary.",
            "temp:turn_previous_artifact_id": "artifact-1",
        }
    )

    add_routing_context(context, request)

    prompt = request.instructions[0]
    payload = json.loads(prompt.split("ContextPack JSON: ", 1)[1])
    assert payload == {
        "current_text": "What is the weather in Minsk?",
        "language": "en",
        "previous_assistant_text": "Previous answer.",
        "previous_assistant_summary": "Previous summary.",
        "previous_artifact_id": "artifact-1",
    }
