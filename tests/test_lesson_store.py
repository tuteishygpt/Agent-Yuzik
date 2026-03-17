from __future__ import annotations

import json

from api.teacher_mode.lesson_store import LessonStore


def test_lesson_store_resolves_internal_lesson_id_when_filename_differs(tmp_path):
    lessons_dir = tmp_path / "lessons"
    lessons_dir.mkdir()
    (lessons_dir / "basics_months_be.json").write_text(
        json.dumps(
            {
                "lesson_id": "basics_months",
                "title": "Months",
                "level": "A1",
                "lesson_goal": "Learn months",
                "lesson_words": ["studen"],
                "steps": [
                    {
                        "step_id": "intro",
                        "type": "intro",
                        "prompt": "Say studzen",
                        "hint": "Say studzen",
                    }
                ],
                "allowed_transitions": {"intro": ["intro"]},
                "retry_limits": {"intro": 2},
                "hints": {"intro": "Say studzen"},
                "finish_condition": "done",
            }
        ),
        encoding="utf-8",
    )
    lesson_store = LessonStore(str(lessons_dir))

    lesson = lesson_store.get_lesson("basics_months")

    assert lesson.lesson_id == "basics_months"
    assert [item.lesson_id for item in lesson_store.list_lessons()] == ["basics_months"]
