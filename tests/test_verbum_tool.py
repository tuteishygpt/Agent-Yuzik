import asyncio
import importlib
import os
import sys


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_module():
    sys.modules.pop("tools.verbum_tool", None)
    return importlib.import_module("tools.verbum_tool")


def test_lookup_verbum_prefers_grammardb_summary(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(
        module,
        "try_grammardb_full_text",
        lambda word: ["слова — назоўнік; асноўнае значэнне: прыклад"],
    )
    monkeypatch.setattr(module, "search_all_result_urls", lambda word, limit=20: [])

    result = asyncio.run(module.lookup_verbum("слова"))

    assert "назоўнік" in result.text
    assert "прыклад" in result.text


def test_lookup_verbum_returns_not_found_message(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(module, "try_grammardb_full_text", lambda word: [])
    monkeypatch.setattr(module, "search_all_result_urls", lambda word, limit=20: [])

    result = asyncio.run(module.lookup_verbum("невядомае"))

    assert "Verbum" in result.text
    assert "нічога не знойдзена" in result.text


def test_lookup_verbum_returns_service_error_message(monkeypatch):
    module = _load_module()

    def raise_error(word):
        raise RuntimeError("boom")

    monkeypatch.setattr(module, "try_grammardb_full_text", raise_error)

    result = asyncio.run(module.lookup_verbum("слова"))

    assert "Не ўдалося атрымаць" in result.text
