import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { VoiceControls } from "@/features/voice/VoiceControls";

import TeacherScreen from "../../../app/(tabs)/teacher";

const mockOpenMenu = jest.fn();
const mockLoadLessons = jest.fn();
const mockSelectLesson = jest.fn();
const mockStartTeacherLesson = jest.fn();
const mockConnect = jest.fn();
const mockStartListening = jest.fn();
const mockStopListening = jest.fn();
const mockInterrupt = jest.fn();
const mockStopTeacherLesson = jest.fn();
const mockDisconnect = jest.fn();

const lesson = {
  id: "intro-greetings",
  title: "Greetings",
  level: "A1",
  goal: "Practice greetings",
  stepsCount: 1,
  steps: [
    {
      id: "step-1",
      prompt: "Say hello.",
      type: "dialogue",
    },
  ],
};

const travelLesson = {
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
};

const mockTeacherMode: {
  lessons: (typeof lesson)[];
  selectedLesson: typeof lesson | null;
  selectedStep: (typeof lesson.steps)[number] | null;
  currentPrompt: string | null;
  activeLessonId: string | null;
  activeSessionId: string | null;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  getSnapshot: jest.Mock;
  loadLessons: jest.Mock;
  selectLesson: jest.Mock;
  selectStep: jest.Mock;
  setCurrentPrompt: jest.Mock;
  setActiveSession: jest.Mock;
  startLesson: jest.Mock;
  stopLesson: jest.Mock;
  createStartLessonPayload: jest.Mock;
  createStopLessonPayload: jest.Mock;
} = {
  lessons: [lesson],
  selectedLesson: lesson,
  selectedStep: lesson.steps[0],
  currentPrompt: "Say hello.",
  activeLessonId: null,
  activeSessionId: null,
  isActive: false,
  isLoading: false,
  error: null,
  getSnapshot: jest.fn(),
  loadLessons: mockLoadLessons,
  selectLesson: mockSelectLesson,
  selectStep: jest.fn(),
  setCurrentPrompt: jest.fn(),
  setActiveSession: jest.fn(),
  startLesson: jest.fn(),
  stopLesson: jest.fn(),
  createStartLessonPayload: jest.fn(),
  createStopLessonPayload: jest.fn(),
};

const mockVoiceSession = {
  status: "connected",
  connectionStatus: "connected",
  voiceConfig: null,
  transcript: [],
  retryNotice: null,
  error: null,
  isRecording: false,
  isListening: false,
  isPlaying: false,
  teacherSelection: {
    lessonId: "intro-greetings",
    stepId: "step-1",
    prompt: "Say hello.",
    active: false,
  },
  connect: mockConnect,
  reconnect: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  startListening: mockStartListening,
  stopListening: mockStopListening,
  interrupt: mockInterrupt,
  startTeacherLesson: mockStartTeacherLesson,
  stopTeacherLesson: mockStopTeacherLesson,
  disconnect: mockDisconnect,
};

jest.mock("@/navigation/MenuContext", () => ({
  useMenu: () => ({
    openMenu: mockOpenMenu,
  }),
}));

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    status: "ready",
    session: { access_token: "token-123" },
  }),
}));

jest.mock("@/lib/supabase", () => ({
  getSupabaseSession: jest
    .fn()
    .mockResolvedValue({ access_token: "token-123" }),
}));

jest.mock("@/lib/env", () => ({
  getRuntimeEnv: () => ({ backendUrl: "https://api.yuzik.example" }),
}));

jest.mock("@/features/teacher/useTeacherMode", () => ({
  useTeacherMode: () => mockTeacherMode,
}));

const mockUseVoiceSession = jest.fn((_options?: unknown) => mockVoiceSession);

jest.mock("@/features/voice/useVoiceSession", () => ({
  useVoiceSession: (options: unknown) => mockUseVoiceSession(options),
}));

jest.mock("expo-router", () => {
  return {
    useFocusEffect: () => undefined,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

function readText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((node) => String(node.props.children ?? ""))
    .join(" ");
}

function nearestPressable(
  node: TestRenderer.ReactTestInstance | undefined,
): TestRenderer.ReactTestInstance | undefined {
  let current = node?.parent ?? undefined;

  while (current) {
    if (typeof current.props.onPress === "function") {
      return current;
    }

    current = current.parent ?? undefined;
  }

  return undefined;
}

describe("TeacherScreen", () => {
  beforeEach(() => {
    mockTeacherMode.lessons = [lesson];
    mockTeacherMode.selectedLesson = lesson;
    mockTeacherMode.selectedStep = lesson.steps[0];
    mockTeacherMode.currentPrompt = "Say hello.";
    mockTeacherMode.isActive = false;
    mockVoiceSession.status = "connected";
    mockVoiceSession.connectionStatus = "connected";
    mockVoiceSession.isListening = false;
    mockVoiceSession.teacherSelection.active = false;
    mockLoadLessons.mockClear();
    mockSelectLesson.mockClear();
    mockStartTeacherLesson.mockClear();
    mockConnect.mockClear();
    mockStartListening.mockClear();
    mockStopListening.mockClear();
    mockInterrupt.mockClear();
    mockStopTeacherLesson.mockClear();
    mockDisconnect.mockClear();
    mockUseVoiceSession.mockClear();
    mockUseVoiceSession.mockReturnValue(mockVoiceSession);
  });

  it("runs the teacher lesson on the teacher screen without routing to voice", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<TeacherScreen />);
    });

    const text = readText(renderer);
    expect(text).toContain("Настаўнік");
    expect(text).toContain("Greetings");
    expect(text).toContain("Слухаю ўрок");
    expect(text).toContain("Пачаць");
    expect(mockLoadLessons).toHaveBeenCalledWith({
      backendUrl: "https://api.yuzik.example",
      accessToken: "token-123",
    });
    expect(mockStartTeacherLesson).toHaveBeenCalledTimes(1);
    expect(mockUseVoiceSession).toHaveBeenCalledWith({
      teacherMode: mockTeacherMode,
      sessionKind: "teacher",
    });
  });

  it("starts and voices the first task after choosing a lesson from the teacher screen", async () => {
    mockTeacherMode.lessons = [lesson, travelLesson];
    mockTeacherMode.selectedLesson = null;
    mockTeacherMode.selectedStep = null;
    mockTeacherMode.currentPrompt = null;
    mockSelectLesson.mockImplementation((lessonId: string) => {
      const nextLesson =
        mockTeacherMode.lessons.find((item) => item.id === lessonId) ?? null;
      mockTeacherMode.selectedLesson = nextLesson;
      mockTeacherMode.selectedStep = nextLesson?.steps[0] ?? null;
      mockTeacherMode.currentPrompt = nextLesson?.steps[0]?.prompt ?? null;
    });

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<TeacherScreen />);
    });

    expect(mockStartTeacherLesson).not.toHaveBeenCalled();

    const chooseButton = renderer.root.findAll(
      (node) => node.props.accessibilityRole === "button",
    )[0];

    await act(async () => {
      chooseButton.props.onPress();
    });

    const travelText = renderer.root
      .findAllByType(Text)
      .find((node) =>
        String(node.props.children ?? "").includes("Travel basics"),
      );
    const travelOption = nearestPressable(travelText);

    expect(travelOption).toBeTruthy();

    await act(async () => {
      travelOption?.props.onPress();
      renderer.update(<TeacherScreen />);
    });

    const text = readText(renderer);
    expect(mockSelectLesson).toHaveBeenCalledWith("travel-basics");
    expect(mockStartTeacherLesson).toHaveBeenCalledTimes(1);
    expect(text).toContain("Travel basics");
    expect(text).toContain("Ask for a ticket.");
    expect(text).not.toContain("Ask for tickets");
  });

  it("stops the teacher lesson and disconnects when the active teacher session is stopped", async () => {
    mockTeacherMode.isActive = true;
    mockVoiceSession.isListening = true;

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<TeacherScreen />);
    });

    const controls = renderer.root.findByType(VoiceControls);

    act(() => {
      controls.props.onStopListening();
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockStopListening).toHaveBeenCalledTimes(1);
    expect(mockInterrupt).toHaveBeenCalledTimes(1);
    expect(mockStopTeacherLesson).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    mockVoiceSession.isListening = false;
    act(() => {
      renderer.unmount();
    });
  });

  it("does not auto-reconnect the teacher session after a manual stop", async () => {
    mockTeacherMode.isActive = true;
    mockVoiceSession.isListening = true;

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<TeacherScreen />);
    });

    mockConnect.mockClear();
    mockStartTeacherLesson.mockClear();

    const controls = renderer.root.findByType(VoiceControls);

    act(() => {
      controls.props.onStopListening();
    });
    await Promise.resolve();
    await Promise.resolve();

    mockTeacherMode.isActive = false;
    mockVoiceSession.isListening = false;
    mockVoiceSession.status = "idle";
    mockVoiceSession.connectionStatus = "idle";

    await act(async () => {
      renderer.update(<TeacherScreen />);
    });

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockStartTeacherLesson).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it("restarts the teacher lesson after a recoverable socket error reconnects", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<TeacherScreen />);
    });

    expect(mockStartTeacherLesson).toHaveBeenCalledTimes(1);
    mockStartTeacherLesson.mockClear();

    mockVoiceSession.status = "error";
    mockVoiceSession.connectionStatus = "error";

    await act(async () => {
      renderer.update(<TeacherScreen />);
    });

    mockVoiceSession.status = "connected";
    mockVoiceSession.connectionStatus = "connected";

    await act(async () => {
      renderer.update(<TeacherScreen />);
    });

    expect(mockStartTeacherLesson).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });
  });
});
