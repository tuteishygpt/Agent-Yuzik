# ADK Gemini Image Generation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active ADK image generation path with Gemini image generation while keeping the old Fal implementation in the repository but unused.

**Architecture:** Add a new Gemini-backed tool module that preserves the old tool signature where possible, reject unsupported multi-image requests explicitly, and keep ADK artifact delivery unchanged. Wire `router_agent` to the new tool and expose the selected Gemini image model via `.env` and `config.py`.

**Tech Stack:** Python, `google-genai`, Google ADK, pytest, python-dotenv

---

## Chunk 1: Tool tests and implementation

### Task 1: Add failing tests for the Gemini image tool

**Files:**
- Create: `tests/test_gemini_image_generator.py`
- Modify: none
- Test: `tests/test_gemini_image_generator.py`

- [ ] **Step 1: Write the failing tests**

```python
async def test_generate_image_rejects_multiple_images(): ...
async def test_generate_image_uses_configured_model_and_saves_first_image(): ...
async def test_generate_image_returns_text_error_when_no_image_part_exists(): ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_gemini_image_generator.py -v`
Expected: FAIL because `tools.gemini_image_generator` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
async def generate_image(...):
    if number_of_images != 1:
        return types.Part(text="...")
    ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_gemini_image_generator.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_gemini_image_generator.py tools/gemini_image_generator.py
git commit -m "feat: add gemini image generation tool"
```

### Task 2: Add config surface for image model selection

**Files:**
- Modify: `config.py`
- Modify: `.env`
- Test: `tests/test_gemini_image_generator.py`

- [ ] **Step 1: Write the failing test**

```python
def test_generate_image_uses_configured_model_and_saves_first_image():
    assert captured_model == "custom-model-id"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_gemini_image_generator.py::test_generate_image_uses_configured_model_and_saves_first_image -v`
Expected: FAIL because the model is not yet loaded from config.

- [ ] **Step 3: Write minimal implementation**

```python
IMAGE_GENERATION_MODEL = os.getenv("IMAGE_GENERATION_MODEL")
model_name = config.IMAGE_GENERATION_MODEL or "gemini-2.5-flash-image"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_gemini_image_generator.py::test_generate_image_uses_configured_model_and_saves_first_image -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config.py .env tests/test_gemini_image_generator.py tools/gemini_image_generator.py
git commit -m "feat: make gemini image model configurable"
```

## Chunk 2: Router wiring and regression coverage

### Task 3: Switch the active ADK route from Fal to Gemini

**Files:**
- Modify: `router_agent/agent.py`
- Test: `tests/test_gemini_model_aliases.py`

- [ ] **Step 1: Write the failing regression test**

```python
def test_router_agent_imports_gemini_image_tool():
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_gemini_model_aliases.py -v`
Expected: FAIL once the new regression assertion is added and router still imports `tools.flux_generator`.

- [ ] **Step 3: Write minimal implementation**

```python
from tools.gemini_image_generator import generate_image_tool
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_gemini_model_aliases.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add router_agent/agent.py tests/test_gemini_model_aliases.py
git commit -m "feat: route ADK image generation through gemini"
```

### Task 4: Run focused verification

**Files:**
- Modify: none
- Test: `tests/test_gemini_image_generator.py`
- Test: `tests/test_gemini_model_aliases.py`

- [ ] **Step 1: Run focused verification**

Run: `pytest tests/test_gemini_image_generator.py tests/test_gemini_model_aliases.py -v`
Expected: PASS

- [ ] **Step 2: Run broader safety check**

Run: `pytest tests/test_text_to_speech_tool.py -v`
Expected: PASS and no regressions in unrelated tool behavior.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify gemini image generation integration"
```
