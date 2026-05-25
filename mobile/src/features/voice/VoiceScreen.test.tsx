import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import VoiceScreen from "../../../app/(tabs)/voice";

const mockOpenMenu = jest.fn();
const mockUseVoiceSession = jest.fn();
let mockPreferNativeTenVad = false;
let mockFocusCleanup: (() => void) | undefined;
let mockIsFocused = true;

const mockTeacherMode = {
  selectedLesson: {
    id: "teacher-lesson",
    title: "Teacher lesson",
    level: "A1",
    goal: "Practice",
    stepsCount: 1,
    steps: [],
  },
  selectedStep: null,
  currentPrompt: "Teacher prompt",
  isActive: true,
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
    lessonId: null,
    stepId: null,
    prompt: null,
    active: false,
  },
  connect: jest.fn(),
  reconnect: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  startListening: jest.fn(),
  stopListening: jest.fn(),
  interrupt: jest.fn(),
  startTeacherLesson: jest.fn(),
  stopTeacherLesson: jest.fn(),
  disconnect: jest.fn(),
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

jest.mock("@/features/teacher/useTeacherMode", () => ({
  useTeacherMode: () => mockTeacherMode,
}));

jest.mock("@/features/voice/useVoiceSession", () => ({
  useVoiceSession: (...args: unknown[]) => mockUseVoiceSession(...args),
}));

jest.mock("@/providers/VoiceSettingsProvider", () => ({
  useVoiceSettings: () => ({
    preferNativeTenVad: mockPreferNativeTenVad,
    setPreferNativeTenVad: jest.fn(),
  }),
}));

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    if (mockIsFocused) {
      mockFocusCleanup = callback() ?? undefined;
    }
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

describe("VoiceScreen", () => {
  beforeEach(() => {
    mockFocusCleanup = undefined;
    mockIsFocused = true;
    mockUseVoiceSession.mockClear();
    mockVoiceSession.status = "connected";
    mockVoiceSession.connectionStatus = "connected";
    mockVoiceSession.isListening = false;
    mockVoiceSession.isRecording = false;
    mockVoiceSession.isPlaying = false;
    mockVoiceSession.stopListening.mockClear();
    mockVoiceSession.interrupt.mockClear();
    mockVoiceSession.disconnect.mockClear();
    mockUseVoiceSession.mockReturnValue(mockVoiceSession);
  });

  it("opens the plain voice session with teacher mode disabled", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<VoiceScreen />);
    });

    expect(mockUseVoiceSession).toHaveBeenCalledWith({
      teacherMode: null,
      sessionKind: "voice",
      vadConfig: {
        preferNativeTenVad: false,
      },
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  it("disconnects the voice session when leaving the voice screen", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<VoiceScreen />);
    });

    expect(mockFocusCleanup).toBeTruthy();

    await act(async () => {
      mockFocusCleanup?.();
      mockIsFocused = false;
      await Promise.resolve();
    });

    expect(mockVoiceSession.stopListening).toHaveBeenCalledTimes(1);
    expect(mockVoiceSession.interrupt).toHaveBeenCalledTimes(1);
    expect(mockVoiceSession.disconnect).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  it("does not disconnect when the user only stops listening on the voice screen", async () => {
    mockVoiceSession.isListening = true;
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<VoiceScreen />);
    });

    const control = renderer.root.findByProps({
      onStopListening: mockVoiceSession.stopListening,
    });

    await act(async () => {
      control.props.onStopListening();
      await control.props.onInterrupt();
    });

    expect(mockVoiceSession.stopListening).toHaveBeenCalledTimes(1);
    expect(mockVoiceSession.interrupt).toHaveBeenCalledTimes(1);
    expect(mockVoiceSession.disconnect).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it("does not reconnect the voice socket after leaving the voice screen", async () => {
    jest.useFakeTimers();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<VoiceScreen />);
    });

    await act(async () => {
      mockFocusCleanup?.();
      mockIsFocused = false;
      await Promise.resolve();
    });

    mockVoiceSession.status = "idle";
    mockVoiceSession.connectionStatus = "idle";
    mockVoiceSession.connect.mockClear();

    await act(async () => {
      renderer.update(<VoiceScreen />);
      await Promise.resolve();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(mockVoiceSession.connect).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
    jest.useRealTimers();
  });

  it("can reconnect the voice socket after returning to the voice screen", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<VoiceScreen />);
    });

    await act(async () => {
      mockFocusCleanup?.();
      mockIsFocused = false;
      await Promise.resolve();
    });

    mockVoiceSession.status = "idle";
    mockVoiceSession.connectionStatus = "idle";
    mockVoiceSession.connect.mockClear();

    await act(async () => {
      renderer.update(<VoiceScreen />);
      await Promise.resolve();
    });

    expect(mockVoiceSession.connect).not.toHaveBeenCalled();

    await act(async () => {
      mockIsFocused = true;
      renderer.update(<VoiceScreen />);
      await Promise.resolve();
    });

    expect(mockVoiceSession.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });
});
