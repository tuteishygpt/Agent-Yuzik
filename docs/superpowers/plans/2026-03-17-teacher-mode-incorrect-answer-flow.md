# Teacher Mode Incorrect Answer Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make teacher mode correct wrong answers explicitly and advance after a repeated wrong attempt instead of claiming the answer was unheard.

**Architecture:** Keep the change inside `TeacherController`, where lesson state and retry counts already live. Tests drive two deterministic paths: first wrong attempt stays on the current step with a corrective reply, and retry-limit wrong attempts advance to the next allowed step with the correct answer spoken aloud.

**Tech Stack:** Python, pytest, Pydantic

---

## Chunk 1: Tests

### Task 1: First wrong answer stays on the step with a corrective reply

**Files:**
- Modify: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`
- Test: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `pytest tests/test_teacher_mode.py -k wrong_answer -v` and verify it fails because the controller still uses the old fallback behavior**
- [ ] **Step 3: Assert the reply starts with `Амаль. Правільна будзе:` and the step does not advance on the first wrong attempt**

### Task 2: Retry-limit wrong answer advances to the next step

**Files:**
- Modify: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`
- Test: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `pytest tests/test_teacher_mode.py -k repeated_wrong_answer -v` and verify it fails because the controller still returns `hint_and_retry` on retry limit**
- [ ] **Step 3: Assert the controller advances to the next step and includes the correct answer in the reply**

## Chunk 2: Controller

### Task 3: Deterministic wrong-answer correction

**Files:**
- Modify: `D:\CodexPRJ\Yuzik\api\teacher_mode\controller.py`
- Modify: `D:\CodexPRJ\Yuzik\api\teacher_mode\phrases.py`

- [ ] **Step 1: Add phrase keys for corrective replies and retry-limit advance text**
- [ ] **Step 2: Add a helper that resolves a short spoken correct answer from the current lesson step**
- [ ] **Step 3: Override model reply/action for `incorrect`, `partially_correct`, and `off_topic`**
- [ ] **Step 4: Replace retry-limit hint escalation with retry-limit advance when a next step exists**

## Chunk 3: Verification

### Task 4: Teacher-mode regression check

**Files:**
- Test: `D:\CodexPRJ\Yuzik\tests\test_teacher_mode.py`

- [ ] **Step 1: Run `pytest tests/test_teacher_mode.py -v`**
- [ ] **Step 2: Confirm the new wrong-answer tests and the existing teacher-mode tests pass**
