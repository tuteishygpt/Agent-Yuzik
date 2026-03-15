from __future__ import annotations

import json
from pathlib import Path

from api.teacher_mode.models import LessonDefinition


class LessonStore:
    def __init__(self, lessons_dir: str = "data/lessons"):
        self._lessons_dir = Path(lessons_dir)
        self._cache: dict[str, LessonDefinition] = {}

    def list_lessons(self) -> list[LessonDefinition]:
        return [self.get_lesson(p.stem) for p in sorted(self._lessons_dir.glob("*.json"))]

    def get_lesson(self, lesson_id: str) -> LessonDefinition:
        if lesson_id in self._cache:
            return self._cache[lesson_id]

        path = self._lessons_dir / f"{lesson_id}.json"
        if not path.exists():
            raise KeyError(f"Lesson '{lesson_id}' not found")

        payload = json.loads(path.read_text(encoding="utf-8"))
        lesson = LessonDefinition.model_validate(payload)
        self._cache[lesson_id] = lesson
        return lesson
