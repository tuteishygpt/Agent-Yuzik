import {
  type LoadTeacherLessonsOptions,
  type TeacherLesson,
  type TeacherLessonCatalogResponse,
} from "@/features/teacher/teacher-types";

export function normalizeTeacherLessonCatalog(
  response: TeacherLessonCatalogResponse,
): TeacherLesson[] {
  return response.lessons.map((lesson) => ({
    id: lesson.lesson_id,
    title: lesson.title,
    level: lesson.level,
    goal: lesson.lesson_goal,
    stepsCount: lesson.steps_count,
    steps: lesson.steps.map((step) => ({
      id: step.step_id,
      prompt: step.prompt,
      type: step.type,
    })),
  }));
}

export const normalizeLessonCatalogResponse = normalizeTeacherLessonCatalog;

function buildTeacherLessonsUrl(backendUrl: string): string {
  return `${backendUrl.replace(/\/+$/, "")}/api/teacher/lessons`;
}

export async function loadTeacherLessons({
  backendUrl,
  accessToken,
  fetchImpl = globalThis.fetch,
}: LoadTeacherLessonsOptions): Promise<TeacherLesson[]> {
  if (!accessToken.trim()) {
    throw new Error("Missing teacher access token.");
  }

  const response = await fetchImpl(buildTeacherLessonsUrl(backendUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to load teacher lessons.");
  }

  const payload = (await response.json()) as TeacherLessonCatalogResponse;

  return normalizeTeacherLessonCatalog(payload);
}
