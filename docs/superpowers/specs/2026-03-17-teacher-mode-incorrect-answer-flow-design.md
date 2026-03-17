# Teacher Mode Incorrect Answer Flow Design

## Goal

Make `teacher_mode` react to wrong answers as teaching mistakes rather than as failed audio recognition.

## Current Problem

The current controller uses the same fallback phrase for multiple failure modes. That causes two user-facing problems:

- a clearly wrong answer can trigger `Дрэнна пачуў адказ. Паўтарым крок.`, which sounds like ASR failed instead of the student answering incorrectly
- after the retry limit is reached, the controller switches to `hint_and_retry` instead of moving on, so the lesson can get stuck on the same step

The root cause is deterministic controller logic:

- `_fallback_reply()` always prefixes with `TEACHER_PHRASES["fallback_reply_prefix"]`
- the retry-limit branch rewrites repeated wrong answers into `hint_and_retry`

## Decision

Handle repeated wrong answers explicitly in `TeacherController`:

- first wrong attempt: reply with `Амаль. Правільна будзе: <correct answer>.` and stay on the same step
- repeated wrong attempt at the retry limit: reply with `Амаль. Правільна будзе: <correct answer>. Ідзем далей.` and advance to the next allowed step
- unclear audio or model/parse failures may still use the existing "did not hear well" fallback language

## Scope

- Add deterministic wrong-answer handling for `incorrect`, `partially_correct`, and `off_topic`
- Derive the corrective answer from lesson metadata, preferring `expected_answer` and falling back to the step hint
- Preserve the existing unclear-audio and invalid-transition fallback behavior
- Replace retry-limit hint escalation with retry-limit advance when a next step exists

## Risks And Mitigation

- Some steps have multiple valid answers separated by `|`; use the first variant as the spoken correction to keep TTS short and deterministic
- Some intro/summary steps may not have `expected_answer`; fall back to a cleaned hint so the reply still teaches a concrete target
- Summary/final steps may not have a real next step; in that case keep the user on the current step and avoid forced completion

## Validation

- Add a failing test proving the first wrong answer says `Амаль. Правільна будзе:` and does not say `Дрэнна пачуў адказ`
- Add a failing test proving the repeated wrong answer advances to the next step and includes the correct answer
- Run the focused teacher-mode pytest file after implementation
