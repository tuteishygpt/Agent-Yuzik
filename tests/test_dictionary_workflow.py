import asyncio
import os
import sys

from google.genai import types


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}


def test_dictionary_lookup_node_prompts_and_sets_pending_word_action():
    from yuzik_workflow.dictionary import dictionary_lookup_node
    from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY

    ctx = FakeContext({"temp:dictionary_needs_word": True})

    result = asyncio.run(dictionary_lookup_node(ctx, object()))

    assert isinstance(result, types.Content)
    assert ctx.state[PENDING_TEXT_ACTION_KEY]["kind"] == "dictionary"
    assert "\u042f\u043a\u043e\u0435 \u0441\u043b\u043e\u0432\u0430" in result.parts[0].text


def test_dictionary_lookup_node_calls_dictionary_tool_and_clears_pending(monkeypatch):
    import yuzik_workflow.dictionary as module
    from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY

    calls = {}

    async def fake_lookup_dictionary(word, sources=None, slounik_dicts=None):
        calls["word"] = word
        calls["sources"] = sources
        calls["slounik_dicts"] = slounik_dicts
        return types.Part(text="\u0432\u044b\u043d\u0456\u043a")

    monkeypatch.setattr(module, "lookup_dictionary", fake_lookup_dictionary)
    ctx = FakeContext(
        {
            "temp:dictionary_word": "\u0432\u043e\u0441\u0442\u0440\u0430\u045e",
            "temp:dictionary_sources": ["slounik"],
            "temp:slounik_dicts": ["bn"],
            PENDING_TEXT_ACTION_KEY: {"kind": "dictionary"},
        }
    )

    result = asyncio.run(module.dictionary_lookup_node(ctx, object()))

    assert result.parts[0].text == "\u0432\u044b\u043d\u0456\u043a"
    assert calls == {
        "word": "\u0432\u043e\u0441\u0442\u0440\u0430\u045e",
        "sources": ["slounik"],
        "slounik_dicts": ["bn"],
    }
    assert ctx.state[PENDING_TEXT_ACTION_KEY] is None
