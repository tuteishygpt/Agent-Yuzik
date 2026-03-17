from __future__ import annotations

import re

TEACHER_PHRASES = {
    "correction_prefix": "Амаль. Правільна будзе:",
    "advance_after_correction": "Ідзем далей.",
    "retry_prefix": "Падказка:",
    "fallback_reply_prefix": "Дрэнна пачуў адказ. Паўтарым крок.",
    "fallback_success_reply": "Ідзем далей.",
    "generic_short_answer": "Скажы кароткі адказ па-беларуску.",
    "generic_acknowledgement": "Добра.",
    "transcribe_instruction": (
        "Transcribe this short student audio in Belarusian. "
        "Return only the recognized words, no explanations, no quotes, no markdown. "
        "If the child says only part of the answer, return exactly that partial answer. "
        "If speech is unclear, return an empty string.\n"
    ),
    "transcribe_lesson_prefix": "Lesson:",
    "transcribe_current_step_prefix": "Current step:",
    "transcribe_expected_hint_prefix": "Expected hint:",
    "evaluate_instruction": (
        "You are a Belarusian language teacher evaluator. Return ONLY strict JSON with fields: "
        "input_understanding, evaluation, pedagogical_action, tts_output. Keep reply_text short and voice-friendly. "
        "Give one main correction only. Use the transcript as the primary input. "
        "If the transcript is empty or unclear choose repeat_question or hint_and_retry. "
        "Do not output markdown."
    ),
    "evaluate_audio_instruction": (
        "Analyze the attached student audio and evaluate the answer in one step. "
        "First derive the student's Belarusian transcript from the audio, then fill the JSON fields. "
        "Put the recognized text into input_understanding.transcript and a normalized lowercase variant into "
        "input_understanding.normalized_transcript. If speech is unclear, leave transcript empty and choose "
        "repeat_question or hint_and_retry. Do not output markdown."
    ),
    "lesson_context_prefix": "LESSON_CONTEXT=",
    "session_state_prefix": "SESSION_STATE=",
    "asr_transcript_prefix": "ASR_TRANSCRIPT=",
    "evaluate_transcript_instruction": "Analyze the student's answer using the transcript.",
    "transcript_prefixes": ("transcript:", "recognized:", "response:"),
    "roleplay_evaluate_instruction": (
        "This step is a ROLEPLAY exercise. There is no single correct answer. "
        "The student must achieve the communicative goal described in goal_description. "
        "Evaluate whether the student's response is meaningful, polite, and achieves the goal. "
        "Use student_answer_status=goal_achieved if the goal is met, or partially_correct / incorrect otherwise. "
        "Provide encouraging feedback in reply_text."
    ),
    "translate_hint_prefix": "Перакладзі на беларускую:",
    "fill_blank_hint_prefix": "Скончы сказ:",
    "choice_hint_prefix": "Абяры правільны варыянт:",
}

TEACHER_PRAISE_WORDS = (
    "цудоўна",
    "бліскуча",
    "выдатна",
    "дасканала",
    "бездакорна",
    "вельмі добра",
    "надзвычай добра",
    "пышна",
    "шыкоўна",
    "супер",
)

_PRAISE_PATTERN = re.compile(
    r"^(?:" + "|".join(re.escape(word) for word in sorted(TEACHER_PRAISE_WORDS, key=len, reverse=True)) + r")[.!?]?\s*",
    flags=re.IGNORECASE,
)


def choose_praise_word(seed: str) -> str:
    if not seed:
        return TEACHER_PRAISE_WORDS[0]
    index = sum(ord(char) for char in seed) % len(TEACHER_PRAISE_WORDS)
    return TEACHER_PRAISE_WORDS[index]


def prepend_praise(text: str, *, seed: str) -> str:
    cleaned = strip_leading_praise(text)
    praise = choose_praise_word(seed)
    return f"{praise.capitalize()}. {cleaned}".strip()


def strip_leading_praise(text: str) -> str:
    return _PRAISE_PATTERN.sub("", text.strip(), count=1).strip()
