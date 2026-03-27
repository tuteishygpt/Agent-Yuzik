import { useSyncExternalStore } from "react";

import { loadTeacherLessons } from "@/features/teacher/lesson-api";
import {
  type LoadTeacherLessonsOptions,
  type TeacherLesson,
  type TeacherLessonStep,
  type TeacherModeController,
  type TeacherModeSnapshot,
  type TeacherStartLessonPayload,
  type TeacherStopLessonPayload,
} from "@/features/teacher/teacher-types";

type TeacherModeState = {
  lessons: TeacherLesson[];
  selectedLessonId: string | null;
  selectedStepId: string | null;
  currentPrompt: string | null;
  activeLessonId: string | null;
  activeSessionId: string | null;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
};

const defaultState: TeacherModeState = {
  lessons: [],
  selectedLessonId: null,
  selectedStepId: null,
  currentPrompt: null,
  activeLessonId: null,
  activeSessionId: null,
  isActive: false,
  isLoading: false,
  error: null,
};

let state = defaultState;
let snapshot: TeacherModeSnapshot = createSnapshotFromState();
const listeners = new Set<() => void>();

let teacherModeController: TeacherModeController;

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function updateSnapshot() {
  snapshot = createSnapshotFromState();

  if (teacherModeController) {
    Object.assign(teacherModeController, snapshot);
  }
}

function setState(
  updater: TeacherModeState | ((current: TeacherModeState) => TeacherModeState),
) {
  state = typeof updater === "function" ? updater(state) : updater;
  updateSnapshot();
  emitChange();
}

function getLessonById(lessonId: string | null): TeacherLesson | null {
  if (!lessonId) {
    return null;
  }

  return state.lessons.find((lesson) => lesson.id === lessonId) ?? null;
}

function getSelectedStep(
  lesson: TeacherLesson | null,
  stepId: string | null,
): TeacherLessonStep | null {
  if (!lesson || !stepId) {
    return null;
  }

  return lesson.steps.find((step) => step.id === stepId) ?? null;
}

function createSnapshotFromState(): TeacherModeSnapshot {
  const selectedLesson = getLessonById(state.selectedLessonId);
  const selectedStep = getSelectedStep(selectedLesson, state.selectedStepId);

  return {
    lessons: state.lessons,
    selectedLesson,
    selectedStep,
    currentPrompt: state.currentPrompt,
    activeLessonId: state.activeLessonId,
    activeSessionId: state.activeSessionId,
    isActive: state.isActive,
    isLoading: state.isLoading,
    error: state.error,
  };
}

function createStartLessonPayload(): TeacherStartLessonPayload | null {
  const selectedLesson = getLessonById(state.selectedLessonId);
  const selectedStep = getSelectedStep(selectedLesson, state.selectedStepId);

  if (!selectedLesson || !selectedStep) {
    return null;
  }

  return {
    lesson_id: selectedLesson.id,
    step_id: selectedStep.id,
    prompt: state.currentPrompt ?? selectedStep.prompt,
  };
}

function createStopLessonPayload(): TeacherStopLessonPayload | null {
  if (!state.activeLessonId && !state.activeSessionId) {
    return null;
  }

  if (state.activeSessionId) {
    return {
      session_id: state.activeSessionId,
    };
  }

  return {
    lesson_id: state.activeLessonId ?? undefined,
  };
}

function selectLesson(lessonId: string) {
  const nextLesson = state.lessons.find((lesson) => lesson.id === lessonId) ?? null;

  if (!nextLesson) {
    return;
  }

  const firstStep = nextLesson.steps[0] ?? null;

  setState((current) => ({
    ...current,
    selectedLessonId: nextLesson.id,
    selectedStepId: firstStep?.id ?? null,
    currentPrompt: firstStep?.prompt ?? null,
    activeLessonId: null,
    activeSessionId: null,
    isActive: false,
    error: null,
  }));
}

function selectStep(stepId: string) {
  const selectedLesson = getLessonById(state.selectedLessonId);

  if (!selectedLesson) {
    return;
  }

  const nextStep = selectedLesson.steps.find((step) => step.id === stepId) ?? null;

  if (!nextStep) {
    return;
  }

  setState((current) => ({
    ...current,
    selectedStepId: nextStep.id,
    currentPrompt: nextStep.prompt,
    error: null,
  }));
}

function setCurrentPrompt(prompt: string) {
  setState((current) => ({
    ...current,
    currentPrompt: prompt,
  }));
}

function setActiveSession(sessionId: string | null) {
  setState((current) => ({
    ...current,
    activeSessionId: sessionId,
    isActive: sessionId != null || current.activeLessonId != null,
  }));
}

async function loadLessons(options: LoadTeacherLessonsOptions): Promise<void> {
  setState((current) => ({
    ...current,
    isLoading: true,
    error: null,
  }));

  try {
    const lessons = await loadTeacherLessons(options);

    setState((current) => {
      const selectedLesson =
        current.selectedLessonId == null
          ? null
          : lessons.find((lesson) => lesson.id === current.selectedLessonId) ?? null;
      const selectedStep =
        selectedLesson == null || current.selectedStepId == null
          ? null
          : selectedLesson.steps.find((step) => step.id === current.selectedStepId) ?? null;

      return {
        ...current,
        lessons,
        selectedLessonId: selectedLesson?.id ?? null,
        selectedStepId: selectedStep?.id ?? null,
        currentPrompt: selectedStep?.prompt ?? null,
        isLoading: false,
      };
    });
  } catch (error) {
    setState((current) => ({
      ...current,
      isLoading: false,
      error: error instanceof Error ? error.message : "Failed to load teacher lessons.",
    }));
  }
}

function startLesson(options?: { sessionId?: string | null }): TeacherStartLessonPayload | null {
  const payload = createStartLessonPayload();

  if (!payload) {
    return null;
  }

  setState((current) => ({
    ...current,
    activeLessonId: payload.lesson_id,
    activeSessionId: options?.sessionId ?? payload.lesson_id,
    isActive: true,
    error: null,
  }));

  return payload;
}

function stopLesson(): TeacherStopLessonPayload | null {
  const payload = createStopLessonPayload();

  if (!payload) {
    return null;
  }

  setState((current) => ({
    ...current,
    activeLessonId: null,
    activeSessionId: null,
    isActive: false,
    error: null,
  }));

  return payload;
}

function getSnapshot() {
  return snapshot;
}

teacherModeController = {
  ...snapshot,
  getSnapshot,
  loadLessons,
  selectLesson,
  selectStep,
  setCurrentPrompt,
  setActiveSession,
  startLesson,
  stopLesson,
  createStartLessonPayload,
  createStopLessonPayload,
};

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function resetTeacherModeForTests() {
  state = defaultState;
  updateSnapshot();
}

export function useTeacherMode(): TeacherModeController {
  const currentSnapshot = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

  return {
    ...teacherModeController,
    ...currentSnapshot,
  };
}

export { teacherModeController };
