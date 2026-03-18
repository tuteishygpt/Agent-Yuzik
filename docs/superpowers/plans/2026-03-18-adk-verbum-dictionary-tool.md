# ADK Verbum Dictionary Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ADK Verbum dictionary tool that summarizes Belarusian dictionary and grammar information from Verbum and routes dictionary-style requests through it.

**Architecture:** Add a new async `tools/verbum_tool.py` module that owns the Verbum lookup flow: text normalization, direct `grammardb` lookup, fallback site search, article extraction, deduplication, and concise Belarusian summary formatting. Wire `router_agent` to prefer this tool for dictionary requests, and cover the path with focused pytest tests plus a router regression check.

**Tech Stack:** Python, `requests`, `beautifulsoup4`, Google ADK `FunctionTool`, pytest

---

## File Structure

- `tools/verbum_tool.py`
  Own the full Verbum integration: normalization helpers, HTML fetching, article text extraction, grammardb-first lookup, fallback search, summary building, and `verbum_tool = FunctionTool(lookup_verbum)`.
- `router_agent/agent.py`
  Import the new tool, add it to the tool list, and update the router instruction so dictionary-style requests prefer `verbum_tool` and return a Verbum-specific not-found answer rather than falling back to `search_agent`.
- `tests/test_verbum_tool.py`
  Unit coverage for the tool contract and lookup flow using monkeypatched helpers instead of real HTTP requests.
- `tests/test_gemini_model_aliases.py`
  Regression coverage for router wiring so the Verbum tool stays imported, mentioned in the router instruction, and included in the tools list.

Do not modify `services/adk_service.py`, `config.py`, or `requirements.txt` unless implementation proves a concrete gap. Execute with `@test-driven-development`, and use `@verification-before-completion` before claiming the work is done.

## Chunk 1: Verbum tool

### Task 1: Add failing tests for the Verbum tool contract

**Files:**
- Create: `tests/test_verbum_tool.py`
- Test: `tests/test_verbum_tool.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_verbum_tool.py -v`
Expected: FAIL because `tools.verbum_tool` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
async def lookup_verbum(word: str):
    query = normalize_text(word)
    try:
        grammar_texts = try_grammardb_full_text(query)
        if grammar_texts:
            return types.Part(text=_summarize_texts(query, grammar_texts))
        urls = search_all_result_urls(query)
        if not urls:
            return types.Part(text=f"У Verbum нічога не знойдзена для: {query}.")
        article_texts = [fetch_article_full_text(url) for url in urls]
        article_texts = [text for text in article_texts if text]
        if not article_texts:
            return types.Part(text=f"У Verbum нічога не знойдзена для: {query}.")
        return types.Part(text=_summarize_texts(query, article_texts))
    except Exception:
        return types.Part(text="Не ўдалося атрымаць даныя з Verbum. Паспрабуй крыху пазней.")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_verbum_tool.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_verbum_tool.py tools/verbum_tool.py
git commit -m "feat: add Verbum dictionary ADK tool"
```

### Task 2: Add fallback search, deduplication, and summary behavior

**Files:**
- Modify: `tools/verbum_tool.py`
- Modify: `tests/test_verbum_tool.py`
- Test: `tests/test_verbum_tool.py`

- [ ] **Step 1: Add the next failing tests**

```python
def test_lookup_verbum_falls_back_to_search_results_and_deduplicates(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(module, "try_grammardb_full_text", lambda word: [])
    monkeypatch.setattr(module, "search_all_result_urls", lambda word, limit=20: ["https://verbum.by/a", "https://verbum.by/b"])
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
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `python -m pytest tests/test_verbum_tool.py::test_lookup_verbum_falls_back_to_search_results_and_deduplicates tests/test_verbum_tool.py::test_try_grammardb_full_text_rejects_non_grammar_pages -v`
Expected: FAIL because fallback aggregation and grammardb filtering are still incomplete.

- [ ] **Step 3: Write minimal implementation**

```python
def try_grammardb_full_text(word: str) -> list[str]:
    soup = fetch_html(GRAMMAR_URL + quote(word, safe=""))
    full_text = extract_best_text_block(soup)
    lowered = full_text.lower()
    if any(marker in lowered for marker in grammar_markers):
        return [full_text]
    return []


def lookup_verbum_all_texts(word: str) -> list[str]:
    grammar_texts = try_grammardb_full_text(word)
    if grammar_texts:
        return grammar_texts
    texts = []
    for url in search_all_result_urls(word):
        full_text = fetch_article_full_text(url)
        if full_text:
            texts.append(full_text)
    return texts


def _summarize_texts(word: str, texts: list[str]) -> str:
    unique_texts = []
    seen = set()
    for text in texts:
        normalized = clean_spaces(text)
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_texts.append(normalized)
    return f"У Verbum для «{word}»: " + " ".join(unique_texts[:2])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_verbum_tool.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_verbum_tool.py tools/verbum_tool.py
git commit -m "feat: summarize Verbum lookup results"
```

## Chunk 2: Router wiring and verification

### Task 3: Add router regression coverage for dictionary routing

**Files:**
- Modify: `tests/test_gemini_model_aliases.py`
- Test: `tests/test_gemini_model_aliases.py`

- [ ] **Step 1: Write the failing regression test**

```python
def test_router_agent_imports_verbum_tool_and_mentions_dictionary_routing():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    assert "from tools.verbum_tool import verbum_tool" in text
    assert "`verbum_tool`" in text
    assert "Verbum" in text
    assert "verbum_tool," in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_gemini_model_aliases.py::test_router_agent_imports_verbum_tool_and_mentions_dictionary_routing -v`
Expected: FAIL because `router_agent` does not yet mention the Verbum tool.

- [ ] **Step 3: Write minimal implementation**

```python
from tools.verbum_tool import verbum_tool

instruction = r"""
        • Калі патрэбны пошук у інтэрнэце — выклікай `search_agent`.
        • Калі пытаюцца пра слова ў слоўніку, яго значэнне, граматыку, формы або правапіс — выклікай `verbum_tool`.
        • Калі `verbum_tool` нічога не знайшоў, паведам пра гэта і не пераходзь да `search_agent`.
        • Калі трэба ведаць актуальныя дату ці час па Мінску — выклікай `minsk_datetime_tool`.
"""

tools=[
    agent_tool.AgentTool(agent=search_agent),
    agent_tool.AgentTool(agent=meme_agent),
    verbum_tool,
    minsk_datetime_tool,
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_gemini_model_aliases.py::test_router_agent_imports_verbum_tool_and_mentions_dictionary_routing -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add router_agent/agent.py tests/test_gemini_model_aliases.py
git commit -m "feat: route dictionary requests through Verbum tool"
```

### Task 4: Run focused verification

**Files:**
- Modify: none
- Test: `tests/test_verbum_tool.py`
- Test: `tests/test_gemini_model_aliases.py`
- Test: `tests/test_weather_tool.py`
- Test: `tests/test_gemini_image_generator.py`

- [ ] **Step 1: Run focused verification**

Run: `python -m pytest tests/test_verbum_tool.py tests/test_gemini_model_aliases.py -v`
Expected: PASS

- [ ] **Step 2: Run router-adjacent safety checks**

Run: `python -m pytest tests/test_weather_tool.py tests/test_gemini_image_generator.py -v`
Expected: PASS and no regression in the existing weather and image tool paths.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify Verbum dictionary integration"
```
