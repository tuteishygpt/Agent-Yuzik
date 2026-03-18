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


def test_lookup_verbum_falls_back_to_search_results_and_deduplicates(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(module, "try_grammardb_full_text", lambda word: [])
    monkeypatch.setattr(
        module,
        "search_all_result_urls",
        lambda word, limit=20: ["https://verbum.by/a", "https://verbum.by/b"],
    )
    monkeypatch.setattr(
        module,
        "fetch_article_full_text",
        lambda url: "адно і тое ж тлумачэнне" if url.endswith(("a", "b")) else None,
    )

    result = asyncio.run(module.lookup_verbum("слова"))

    assert result.text.count("адно і тое ж тлумачэнне") == 1


def test_try_grammardb_full_text_rejects_non_grammar_pages(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(module, "fetch_html", lambda url: object())
    monkeypatch.setattr(module, "extract_best_text_block", lambda soup: "кароткая навіна без граматыкі")

    assert module.try_grammardb_full_text("слова") == []


def test_search_all_result_urls_filters_noisy_links(monkeypatch):
    module = _load_module()
    html = """
    <html><body>
      <a href="/?q=test">noise</a>
      <a href="/search">search</a>
      <a href="/tag/grammar">tag</a>
      <a href="https://verbum.by/article/test">тэст артыкул</a>
    </body></html>
    """

    monkeypatch.setattr(module, "fetch_html", lambda url: module.BeautifulSoup(html, "html.parser"))

    urls = module.search_all_result_urls("тэст")

    assert urls == ["https://verbum.by/article/test"]
