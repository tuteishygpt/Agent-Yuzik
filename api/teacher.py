from __future__ import annotations

from fastapi import APIRouter

from api.teacher_mode.service import controller as teacher_controller

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


@router.get("/lessons")
async def list_lessons():
    lessons = teacher_controller.lesson_store.list_lessons()
    return {
        "lessons": [
            {
                "lesson_id": lesson.lesson_id,
                "title": lesson.title,
                "level": lesson.level,
                "lesson_goal": lesson.lesson_goal,
                "steps_count": len(lesson.steps),
                "steps": [
                    {
                        "step_id": step.step_id,
                        "prompt": step.prompt,
                        "type": step.type,
                    }
                    for step in lesson.steps
                ],
            }
            for lesson in lessons
        ]
    }
