import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import {
  resetTeacherModeForTests,
  teacherModeController,
  useTeacherMode,
} from "./useTeacherMode";

let latestTeacherMode: ReturnType<typeof useTeacherMode> | null = null;

function createLessonsResponse() {
  return {
    lessons: [
      {
        lesson_id: "intro-greetings",
        title: "Greetings",
        level: "A1",
        lesson_goal: "Practice simple greetings",
        steps_count: 2,
        steps: [
          {
            step_id: "step-1",
            prompt: "Say hello and ask how the listener is doing.",
            type: "dialogue",
          },
          {
            step_id: "step-2",
            prompt: "Say goodbye politely.",
            type: "dialogue",
          },
        ],
      },
    ],
  };
}

function createFetchMock() {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => createLessonsResponse(),
  });
}

function TeacherModeProbe() {
  latestTeacherMode = useTeacherMode();

  return (
    <Text>
      {[
        latestTeacherMode.isLoading ? "loading" : "ready",
        latestTeacherMode.selectedLesson?.id ?? "none",
        latestTeacherMode.selectedStep?.id ?? "none",
        latestTeacherMode.currentPrompt ?? "none",
        latestTeacherMode.isActive ? "active" : "inactive",
      ].join("|")}
    </Text>
  );
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useTeacherMode", () => {
  beforeEach(() => {
    latestTeacherMode = null;
    resetTeacherModeForTests();
  });

  it("selecting a lesson sets the first step and prompt", async () => {
    await act(async () => {
      await teacherModeController.loadLessons({
        backendUrl: "https://api.yuzik.example",
        accessToken: "token-123",
        fetchImpl: createFetchMock(),
      });
    });

    await act(async () => {
      TestRenderer.create(<TeacherModeProbe />);
    });

    await act(async () => {
      latestTeacherMode?.selectLesson("intro-greetings");
    });

    expect(latestTeacherMode?.selectedLesson?.id).toBe("intro-greetings");
    expect(latestTeacherMode?.selectedStep?.id).toBe("step-1");
    expect(latestTeacherMode?.currentPrompt).toBe(
      "Say hello and ask how the listener is doing.",
    );
  });

  it("serializes a minimal teacher_start_lesson payload", async () => {
    await act(async () => {
      await teacherModeController.loadLessons({
        backendUrl: "https://api.yuzik.example",
        accessToken: "token-123",
        fetchImpl: createFetchMock(),
      });
    });

    act(() => {
      teacherModeController.selectLesson("intro-greetings");
      teacherModeController.selectStep("step-2");
      teacherModeController.setCurrentPrompt("Say goodbye with a custom prompt.");
    });

    expect(teacherModeController.createStartLessonPayload()).toEqual({
      lesson_id: "intro-greetings",
      step_id: "step-2",
      prompt: "Say goodbye with a custom prompt.",
    });
  });

  it("serializes a minimal teacher_stop_lesson payload for the active session", async () => {
    await act(async () => {
      await teacherModeController.loadLessons({
        backendUrl: "https://api.yuzik.example",
        accessToken: "token-123",
        fetchImpl: createFetchMock(),
      });
    });

    act(() => {
      teacherModeController.selectLesson("intro-greetings");
      teacherModeController.startLesson({
        sessionId: "voice-session-1",
      });
    });

    expect(teacherModeController.createStopLessonPayload()).toEqual({
      session_id: "voice-session-1",
    });
  });

  it("survives a screen remount through shared controller state", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      await teacherModeController.loadLessons({
        backendUrl: "https://api.yuzik.example",
        accessToken: "token-123",
        fetchImpl: createFetchMock(),
      });
    });

    await act(async () => {
      renderer = TestRenderer.create(<TeacherModeProbe />);
    });

    await act(async () => {
      latestTeacherMode?.selectLesson("intro-greetings");
      latestTeacherMode?.setActiveSession("voice-session-2");
      latestTeacherMode?.startLesson({
        sessionId: "voice-session-2",
      });
    });

    act(() => {
      renderer.unmount();
    });

    await act(async () => {
      renderer = TestRenderer.create(<TeacherModeProbe />);
    });

    await flushAsyncWork();

    expect(latestTeacherMode?.selectedLesson?.id).toBe("intro-greetings");
    expect(latestTeacherMode?.selectedStep?.id).toBe("step-1");
    expect(latestTeacherMode?.isActive).toBe(true);
    expect(latestTeacherMode?.activeSessionId).toBe("voice-session-2");
    expect(latestTeacherMode?.createStopLessonPayload()).toEqual({
      session_id: "voice-session-2",
    });
  });
});
