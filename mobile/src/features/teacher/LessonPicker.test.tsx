import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import LessonPicker from "./LessonPicker";
import {
  loadTeacherLessons,
  normalizeLessonCatalogResponse,
} from "./lesson-api";
import TeacherBanner from "./TeacherBanner";

describe("lesson-api", () => {
  it("normalizes /api/teacher/lessons payloads into mobile lesson types", () => {
    expect(
      normalizeLessonCatalogResponse({
        lessons: [
          {
            lesson_id: "travel-basics",
            title: "Travel basics",
            level: "A2",
            lesson_goal: "Ask for train tickets",
            steps_count: 1,
            steps: [
              {
                step_id: "buy-ticket",
                prompt: "Ask for a return ticket to Minsk.",
                type: "roleplay",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        id: "travel-basics",
        title: "Travel basics",
        level: "A2",
        goal: "Ask for train tickets",
        stepsCount: 1,
        steps: [
          {
            id: "buy-ticket",
            prompt: "Ask for a return ticket to Minsk.",
            type: "roleplay",
          },
        ],
      },
    ]);
  });

  it("loads /api/teacher/lessons with bearer auth", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        lessons: [],
      }),
    });

    await loadTeacherLessons({
      backendUrl: "https://api.yuzik.example",
      accessToken: "token-123",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.yuzik.example/api/teacher/lessons",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          Accept: "application/json",
        }),
      }),
    );
  });

  it("fails cleanly when lesson loading returns a non-2xx response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        detail: "forbidden",
      }),
    });

    await expect(
      loadTeacherLessons({
        backendUrl: "https://api.yuzik.example",
        accessToken: "token-123",
        fetchImpl,
      }),
    ).rejects.toThrow("Failed to load teacher lessons.");
  });
});

describe("LessonPicker", () => {
  const lessons = [
    {
      id: "intro-greetings",
      title: "Greetings",
      level: "A1",
      goal: "Practice simple greetings",
      stepsCount: 2,
      steps: [
        {
          id: "step-1",
          prompt: "Say hello.",
          type: "dialogue",
        },
      ],
    },
    {
      id: "travel-basics",
      title: "Travel basics",
      level: "A2",
      goal: "Ask for tickets",
      stepsCount: 1,
      steps: [
        {
          id: "step-1",
          prompt: "Ask for a ticket.",
          type: "roleplay",
        },
      ],
    },
  ];

  it("renders lessons from a collapsed dropdown", () => {
    const onSelectLesson = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <LessonPicker
          lessons={lessons}
          selectedLessonId="intro-greetings"
          onSelectLesson={onSelectLesson}
        />,
      );
    });

    const textContent = renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");

    expect(textContent).toContain("Greetings");
    expect(textContent).not.toContain("Travel basics");

    const dropdownButton = renderer.root.find(
      (node) =>
        typeof node.props.onPress === "function" &&
        renderer.root
          .findAllByType(Text)
          .map((textNode) => String(textNode.props.children ?? ""))
          .join(" ")
          .includes("Greetings"),
    );

    act(() => {
      dropdownButton.props.onPress();
    });

    const expandedTextContent = renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");

    expect(expandedTextContent).toContain("Travel basics");
  });

  it("collapses to a compact teacher lesson panel after a lesson is selected", () => {
    const onSelectLesson = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <LessonPicker
          lessons={lessons}
          selectedLessonId="intro-greetings"
          stepPrompt="Say hello."
          isActive
          onSelectLesson={onSelectLesson}
        />,
      );
    });

    const textContent = renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");

    expect(textContent).toContain("Greetings");
    expect(textContent).toContain("Say hello.");
    expect(textContent).not.toContain("Practice simple greetings");
    expect(textContent).not.toContain("Travel basics");
  });
});

describe("TeacherBanner", () => {
  it("renders lesson summary, status, and prompt", () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <TeacherBanner
          lesson={{
            id: "intro-greetings",
            title: "Greetings",
            level: "A1",
            goal: "Practice simple greetings",
            stepsCount: 2,
            steps: [
              {
                id: "step-1",
                prompt: "Say hello.",
                type: "dialogue",
              },
            ],
          }}
          stepPrompt="Say hello."
          isActive
        />,
      );
    });

    const textContent = renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");

    expect(textContent).toContain("Greetings");
    expect(textContent).toContain("Active");
    expect(textContent).toContain("Say hello.");
  });
});
