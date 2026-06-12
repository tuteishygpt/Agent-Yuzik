from yuzik_workflow.intent import TurnIntent
from yuzik_workflow.intent_classifier import (
    add_intent_classifier_context,
    intent_classifier_agent,
)


class FakeRequest:
    def __init__(self):
        self.instructions = []

    def append_instructions(self, instructions):
        self.instructions.extend(instructions)


class FakeContext:
    def __init__(self, state):
        self.state = state


def test_classifier_agent_uses_structured_turn_intent_schema():
    assert intent_classifier_agent.name == "intent_classifier_agent"
    assert intent_classifier_agent.output_schema is TurnIntent
    assert intent_classifier_agent.tools == []


def test_classifier_instruction_documents_routes_actions_and_no_answering():
    instruction = intent_classifier_agent.instruction

    assert "Return only the structured schema" in instruction
    assert "Do not answer the user" in instruction
    assert "default" in instruction
    assert "image" in instruction
    assert "translation" in instruction
    assert "direct" in instruction
    assert "cancel" in instruction
    assert "tts" in instruction


def test_classifier_instruction_documents_contextual_tts_examples():
    instruction = intent_classifier_agent.instruction

    assert "Агуч яго" in instruction
    assert "Read it aloud" in instruction
    assert '"actions": ["tts"]' in instruction
    assert '"needs_previous_context": true' in instruction


def test_classifier_context_callback_includes_current_text_and_file_presence():
    request = FakeRequest()
    context = FakeContext(
        {
            "temp:turn_current_text": "Draw a cat",
            "temp:turn_has_file_parts": True,
        }
    )

    add_intent_classifier_context(context, request)

    prompt = request.instructions[0]
    assert '"current_text": "Draw a cat"' in prompt
    assert '"has_file_parts": true' in prompt


def test_classifier_context_callback_includes_previous_context_when_present():
    request = FakeRequest()
    context = FakeContext(
        {
            "temp:turn_current_text": "Read it aloud",
            "temp:turn_previous_text": "A previous answer.",
            "temp:turn_previous_summary": "Previous summary.",
        }
    )

    add_intent_classifier_context(context, request)

    prompt = request.instructions[0]
    assert '"previous_text": "A previous answer."' in prompt
    assert '"previous_summary": "Previous summary."' in prompt
