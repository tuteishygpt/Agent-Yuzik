from __future__ import annotations

import json
from pathlib import Path

from api.teacher_mode.models import LessonDefinition


class LessonStore:
    def __init__(self, lessons_dir: str = "data/lessons"):
        self._lessons_dir = Path(lessons_dir)
        self._cache: dict[str, LessonDefinition] = {}
        self._lesson_ids: list[str] = []
        self._loaded = False

    def list_lessons(self) -> list[LessonDefinition]:
        self._load_lessons()
        return [self._cache[lesson_id] for lesson_id in self._lesson_ids]

    def get_lesson(self, lesson_id: str) -> LessonDefinition:
        self._load_lessons()
        if lesson_id in self._cache:
            return self._cache[lesson_id]

        raise KeyError(f"Lesson '{lesson_id}' not found")

    def _load_lessons(self) -> None:
        if self._loaded:
            return

        lesson_ids: list[str] = []
        cache: dict[str, LessonDefinition] = {}
        for path in sorted(self._lessons_dir.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            lesson = LessonDefinition.model_validate(payload)
            if lesson.lesson_id in cache:
                raise ValueError(f"Duplicate lesson_id '{lesson.lesson_id}' in {path.name}")
            cache[lesson.lesson_id] = lesson
            lesson_ids.append(lesson.lesson_id)

        self._cache = cache
        self._lesson_ids = lesson_ids
        self._loaded = True
