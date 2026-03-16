# Gemini Structured Output Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move teacher-mode Gemini evaluation onto SDK structured outputs and remove fragile response-text JSON cleanup.

**Architecture:** Keep the public adapter contract unchanged. Both Gemini request paths will ask the SDK for `GeminiTeacherResult` structured output, convert `response.parsed` into a normalized payload, and fall back through the existing unclear-result path on failure.

**Tech Stack:** Python, pytest, Pydantic, `google.genai`

---

## Chunk 1: Tests

### Task 1: Structured transcript response

**Files:**
- Modify: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`
- Test: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `pytest tests/test_teacher_mode.py -k structured -v` and verify it fails because code still parses `response.text`**
- [ ] **Step 3: Assert `response_schema=GeminiTeacherResult` and that parsed payload is used**

### Task 2: Structured audio response

**Files:**
- Modify: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`
- Test: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `pytest tests/test_teacher_mode.py -k structured -v` and verify it fails because code still parses `response.text`**
- [ ] **Step 3: Cover transcript backfill from parsed audio output**

## Chunk 2: Adapter

### Task 3: Structured output extraction

**Files:**
- Modify: `D:\CodexPRJ\Yuzik\api\teacher_mode\gemini_adapter.py`

- [ ] **Step 1: Replace manual response-text parsing with a helper that reads `response.parsed`**
- [ ] **Step 2: Set `response_schema=GeminiTeacherResult` on both Gemini calls**
- [ ] **Step 3: Remove `_parse_json_payload`**
- [ ] **Step 4: Keep fallback and normalization behavior intact**

## Chunk 3: Verification

### Task 4: Focused regression check

**Files:**
- Test: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`

- [ ] **Step 1: Run `pytest tests/test_teacher_mode.py -v`**
- [ ] **Step 2: Confirm structured-output tests and existing teacher-mode tests pass**
