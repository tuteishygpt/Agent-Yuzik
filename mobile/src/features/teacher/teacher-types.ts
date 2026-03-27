export type TeacherLessonStep = {
  id: string;
  prompt: string;
  type: string;
};

export type TeacherLesson = {
  id: string;
  title: string;
  level: string;
  goal: string;
  stepsCount: number;
  steps: TeacherLessonStep[];
};

export type TeacherLessonCatalogStep = {
  step_id: string;
  prompt: string;
  type: string;
};

export type TeacherLessonCatalogItem = {
  lesson_id: string;
  title: string;
  level: string;
  lesson_goal: string;
  steps_count: number;
  steps: TeacherLessonCatalogStep[];
};

export type TeacherLessonCatalogResponse = {
  lessons: TeacherLessonCatalogItem[];
};

export type TeacherStartLessonPayload = {
  lesson_id: string;
  step_id: string;
  prompt: string;
};

export type TeacherStopLessonPayload = {
  lesson_id?: string;
  session_id?: string;
};

export type TeacherModeSnapshot = {
  lessons: TeacherLesson[];
  selectedLesson: TeacherLesson | null;
  selectedStep: TeacherLessonStep | null;
  currentPrompt: string | null;
  activeLessonId: string | null;
  activeSessionId: string | null;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
};

export type LoadTeacherLessonsOptions = {
  backendUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
};

export type TeacherModeController = TeacherModeSnapshot & {
  getSnapshot: () => TeacherModeSnapshot;
  loadLessons: (options: LoadTeacherLessonsOptions) => Promise<void>;
  selectLesson: (lessonId: string) => void;
  selectStep: (stepId: string) => void;
  setCurrentPrompt: (prompt: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  startLesson: (options?: { sessionId?: string | null }) => TeacherStartLessonPayload | null;
  stopLesson: () => TeacherStopLessonPayload | null;
  createStartLessonPayload: () => TeacherStartLessonPayload | null;
  createStopLessonPayload: () => TeacherStopLessonPayload | null;
};
