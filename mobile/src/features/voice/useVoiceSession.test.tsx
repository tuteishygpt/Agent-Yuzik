import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { useVoiceSession } from "./useVoiceSession";
import type { VoiceSocketClient, VoiceSocketListener, VoiceSocketMessage } from "@/lib/voice-socket";

const mockTeacherMode = {
  selectedLesson: {
    id: "lesson-1",
    title: "Greetings",
    level: "A1",
    goal: "Say hello",
    stepsCount: 1,
    steps: [
      {
        id: "step-1",
        prompt: "Say hello",
        type: "dialogue",
      },
    ],
  },
  selectedStep: {
    id: "step-1",
    prompt: "Say hello",
    type: "dialogue",
  },
  currentPrompt: "Say hello",
  isActive: false,
  createStartLessonPayload: jest.fn(() => ({
    lesson_id: "lesson-1",
    step_id: "step-1",
    prompt: "Say hello",
  })),
  createStopLessonPayload: jest.fn(() => ({
    lesson_id: "lesson-1",
  })),
  selectLesson: jest.fn(),
  selectStep: jest.fn(),
  setCurrentPrompt: jest.fn(),
  startLesson: jest.fn(),
  stopLesson: jest.fn(),
};

function createSocketClient(): VoiceSocketClient & {
  emit: (message: VoiceSocketMessage) => void;
} {
  let handler: VoiceSocketListener | null = null;
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    sendAudio: jest.fn(),
    sendInterrupt: jest.fn(),
    sendTeacherStartLesson: jest.fn(),
    sendTeacherStopLesson: jest.fn(),
    onMessage: jest.fn((nextHandler: VoiceSocketListener) => {
      handler = nextHandler;
      return () => {
        handler = null;
      };
    }),
    emit(message: VoiceSocketMessage) {
      handler?.(message);
    },
  };
}

function createRecorder() {
  return {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    uri: "file:///tmp/voice.wav",
  };
}

function createPlayback() {
  return {
    play: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    release: jest.fn(),
    isPlaying: false,
  };
}

function toTranscriptText(output: ReturnType<typeof useVoiceSession>) {
  return output.transcript.map((item) => `${item.role}:${item.text}`).join(" | ");
}

function readRenderedText(renderer: TestRenderer.ReactTestRenderer): string {
  const children = renderer.root.findByType(Text).props.children;
  return Array.isArray(children) ? children.join("|") : String(children);
}

describe("useVoiceSession", () => {
  it("updates state from websocket events and keeps teacher selection intact on reconnect", async () => {
    const socket = createSocketClient();
    const recorder = createRecorder();
    const playback = createPlayback();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
        playback: playback as never,
      });

      return (
        <Text>
          {[
            latestSession.connectionStatus,
            latestSession.retryNotice ?? "none",
            latestSession.error ?? "none",
            latestSession.teacherSelection?.lessonId ?? "none",
            toTranscriptText(latestSession),
          ].join("|")}
        </Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
    });

    await act(async () => {
      socket.emit({ type: "voice_config", sample_rate: 16000 });
      socket.emit({ type: "processing" });
      socket.emit({ type: "transcription", text: "hello" });
      socket.emit({ type: "response", text: "hi there" });
      socket.emit({
        type: "teacher_mode_started",
        lesson_id: "lesson-1",
        step_id: "step-1",
        prompt: "Say hello",
        mode: "teacher",
      });
      socket.emit({ type: "teacher_mode_stopped", mode: "assistant" });
      socket.emit({ type: "error", message: "network down" });
      socket.emit({ type: "interruption_handshake" });
    });

    expect(readRenderedText(renderer)).toContain("processing");
    expect(readRenderedText(renderer)).toContain("user:hello");
    expect(readRenderedText(renderer)).toContain("assistant:hi there");
    expect(readRenderedText(renderer)).toContain("lesson-1");
    expect(readRenderedText(renderer)).toContain("network down");

    await act(async () => {
      await latestSession?.reconnect();
    });

    expect(readRenderedText(renderer)).toContain("reconnected, please retry");
    expect(readRenderedText(renderer)).toContain("lesson-1");
  });

  it("stops playback immediately and sends the interrupt protocol message", async () => {
    const socket = createSocketClient();
    const recorder = createRecorder();
    const playback = createPlayback();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
        playback: playback as never,
      });

      return <Text>{latestSession.connectionStatus}</Text>;
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
    });

    await act(async () => {
      await latestSession?.interrupt();
    });

    expect(playback.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendInterrupt).toHaveBeenCalledTimes(1);
  });
});
