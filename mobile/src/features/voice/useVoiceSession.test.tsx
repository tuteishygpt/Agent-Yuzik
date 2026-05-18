import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { useVoiceSession } from "./useVoiceSession";
import type {
  VoiceSocketClient,
  VoiceSocketListener,
  VoiceSocketMessage,
} from "@/lib/voice-socket";

jest.mock("@/lib/audio-recording", () => ({
  createDefaultVoiceRecorderAdapter: jest.fn(() => {
    throw new Error("native recorder unavailable during render");
  }),
}));

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
    prepare: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue({
      uri: "file:///tmp/voice.wav",
      wavBytes: new Uint8Array([1, 2, 3]),
    }),
  };
}

function createPlayback() {
  return {
    playBytes: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    release: jest.fn(),
    isPlaying: jest.fn(() => false),
  };
}

function toTranscriptText(output: ReturnType<typeof useVoiceSession>) {
  return output.transcript
    .map((item) => `${item.role}:${item.text}`)
    .join(" | ");
}

function readRenderedText(renderer: TestRenderer.ReactTestRenderer): string {
  const children = renderer.root.findByType(Text).props.children;
  return Array.isArray(children) ? children.join("|") : String(children);
}

describe("useVoiceSession", () => {
  it("does not initialize the native recorder while rendering", async () => {
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
      });

      return <Text>{latestSession.connectionStatus}</Text>;
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    expect(readRenderedText(renderer)).toBe("idle");
  });

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

    expect(readRenderedText(renderer)).toContain("reconnected");
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

  it("passes voice config playback buffering to audio playback", async () => {
    jest.useFakeTimers();

    const socket = createSocketClient();
    const playback = createPlayback();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;
    let renderer!: TestRenderer.ReactTestRenderer;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        playback: playback as never,
      });

      return <Text>{latestSession.connectionStatus}</Text>;
    }

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      socket.emit({
        type: "voice_config",
        sample_rate: 24000,
        playback_min_buffer_ms: 420,
      });
      socket.emit({ type: "audio", bytes: new Uint8Array([1, 2, 3]) });
    });

    expect(playback.playBytes).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), {
      sampleRate: 24000,
      playbackMinBufferMs: 420,
    });

    await act(async () => {
      renderer.unmount();
    });
    jest.useRealTimers();
  });

  it("fully stops recording during playback and restarts a fresh VAD session afterwards", async () => {
    jest.useFakeTimers();

    const socket = createSocketClient();
    const recorder = createRecorder();
    const playback = createPlayback();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;
    let renderer!: TestRenderer.ReactTestRenderer;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
        playback: playback as never,
        vadConfig: {
          redemptionFrames: 3,
        },
      });

      return <Text>{latestSession.status}</Text>;
    }

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      await latestSession?.startListening();
      socket.emit({ type: "audio", bytes: new Uint8Array([9, 8, 7]) });
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).not.toHaveBeenCalled();

    const oldMetering = recorder.start.mock.calls[0][0] as (db: number) => void;
    await act(async () => {
      [
        -32.2,
        -33.43,
        -35.69,
        -34.1,
        -33.8,
        -34.4,
        -35.2,
        -34.7,
        -33.9,
        -35.1,
        -34.8,
        -35.4,
      ].forEach(oldMetering);
      [-45, -45, -45].forEach(oldMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(2);

    const freshMetering = recorder.start.mock.calls[1][0] as (db: number) => void;
    await act(async () => {
      [
        -32.2,
        -33.43,
        -35.69,
        -34.1,
        -33.8,
        -34.4,
        -35.2,
        -34.7,
        -33.9,
        -35.1,
        -34.8,
        -35.4,
      ].forEach(freshMetering);
      [-45, -45, -45].forEach(freshMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(2);
    expect(socket.sendAudio).toHaveBeenCalledWith({
      wavBytes: new Uint8Array([1, 2, 3]),
    });

    await act(async () => {
      renderer.unmount();
    });
    jest.useRealTimers();
  });

  it("shows a recoverable error when voice socket connect fails", async () => {
    const socket = createSocketClient();
    (socket.connect as jest.Mock).mockRejectedValue(
      new Error("Voice socket connection failed."),
    );
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
      });

      return (
        <Text>{latestSession.error ?? latestSession.connectionStatus}</Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
    });

    expect(readRenderedText(renderer)).toContain(
      "Voice socket connection failed.",
    );
  });

  it("shows a recoverable error when starting a teacher lesson without a connected voice socket", async () => {
    const socket = createSocketClient();
    (socket.sendTeacherStartLesson as jest.Mock).mockImplementation(() => {
      throw new Error("Voice socket is not connected.");
    });
    const teacherMode = {
      ...mockTeacherMode,
      startLesson: jest.fn(),
    };
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: teacherMode as never,
        socketClientFactory: () => socket,
      });

      return (
        <Text>{latestSession.error ?? latestSession.connectionStatus}</Text>
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
      await latestSession?.startTeacherLesson();
    });

    expect(readRenderedText(renderer)).toContain(
      "Voice socket is not connected.",
    );
    expect(teacherMode.startLesson).not.toHaveBeenCalled();
  });

  it("requires creating a voice socket before starting a teacher lesson", async () => {
    const teacherMode = {
      ...mockTeacherMode,
      startLesson: jest.fn(),
    };
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: teacherMode as never,
      });

      return (
        <Text>{latestSession.error ?? latestSession.connectionStatus}</Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.startTeacherLesson();
    });

    expect(readRenderedText(renderer)).toContain(
      "Voice socket is not connected.",
    );
    expect(teacherMode.startLesson).not.toHaveBeenCalled();
  });

  it("shows a recoverable error when recording fails to start asynchronously", async () => {
    const socket = createSocketClient();
    const recorder = createRecorder();
    recorder.start.mockRejectedValue(new Error("Recorder failed to start."));
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder,
      });

      return (
        <Text>{latestSession.error ?? latestSession.connectionStatus}</Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.startRecording();
    });

    const session = latestSession as unknown as ReturnType<
      typeof useVoiceSession
    >;

    expect(readRenderedText(renderer)).toContain("Recorder failed to start.");
    expect(session.isRecording).toBe(false);
  });

  it("sends the VAD recording after speech falls back to the Android live-stream noise floor", async () => {
    const socket = createSocketClient();
    const recorder = createRecorder();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
        vadConfig: {
          redemptionFrames: 3,
        },
      });

      return <Text>{latestSession.status}</Text>;
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      await latestSession?.startListening();
    });

    const onMetering = recorder.start.mock.calls[0][0] as (db: number) => void;

    await act(async () => {
      [
        -32.2,
        -33.43,
        -35.69,
        -34.1,
        -33.8,
        -34.4,
        -35.2,
        -34.7,
        -33.9,
        -35.1,
        -34.8,
        -35.4,
      ].forEach(onMetering);
      [-45, -45, -45].forEach(onMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).toHaveBeenCalledWith({
      wavBytes: new Uint8Array([1, 2, 3]),
    });
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it("drops short low-confidence VAD segments without sending silence to the backend", async () => {
    jest.useFakeTimers();

    const socket = createSocketClient();
    const recorder = createRecorder();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
        vadConfig: {
          redemptionFrames: 3,
        },
      });

      return <Text>{latestSession.status}</Text>;
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      await latestSession?.startListening();
    });

    const onMetering = recorder.start.mock.calls[0][0] as (db: number) => void;

    await act(async () => {
      [-39, -38.5, -39.2].forEach(onMetering);
      [-45, -45, -45].forEach(onMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
