from __future__ import annotations

from api.teacher_mode.controller import TeacherController
from api.teacher_mode.gemini_adapter import GeminiTeacherAdapter
from api.teacher_mode.lesson_store import LessonStore
from api.teacher_mode.session_store import SessionStateStore

lesson_store = LessonStore()
# Session state now persists through the Supabase-backed store wrapper.
session_store = SessionStateStore()
adapter = GeminiTeacherAdapter()
controller = TeacherController(lesson_store, session_store, adapter)
