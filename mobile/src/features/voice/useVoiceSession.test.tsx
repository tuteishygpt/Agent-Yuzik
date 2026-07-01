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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createLocalPcmFrame(sampleCount: number): Uint8Array {
  const frame = new Uint8Array(8 + sampleCount * 4);
  frame.set([0x50, 0x43, 0x4d, 0x00], 0);
  new DataView(frame.buffer).setUint32(4, sampleCount, true);
  return frame;
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

  it("uses a teacher-specific socket identity for teacher sessions", async () => {
    const socket = createSocketClient();
    const createdSockets: Array<{
      url: string;
      getInstallId?: () => Promise<string | null>;
    }> = [];
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        sessionKind: "teacher",
        socketClientFactory: (options) => {
          createdSockets.push(options);
          return socket;
        },
      });

      return <Text>{latestSession.status}</Text>;
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
    });

    expect(createdSockets[0].url).toContain("session_kind=teacher");
    await expect(createdSockets[0].getInstallId?.()).resolves.toContain(
      "-teacher-",
    );
  });

  it("ignores teacher websocket events when teacher mode is disabled", async () => {
    const socket = createSocketClient();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: null,
        socketClientFactory: () => socket,
      });

      return (
        <Text>
          {[
            latestSession.teacherSelection.lessonId ?? "none",
            latestSession.teacherSelection.stepId ?? "none",
            latestSession.teacherSelection.prompt ?? "none",
            latestSession.teacherSelection.active ? "active" : "inactive",
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
      socket.emit({
        type: "teacher_mode_started",
        lesson_id: "lesson-1",
        step_id: "step-1",
        prompt: "Say hello",
        mode: "teacher",
      });
    });

    expect(readRenderedText(renderer)).toBe("none|none|none|inactive");

    await act(async () => {
      renderer.unmount();
    });
  });

  it("updates the current assistant transcript entry for streamed response snapshots", async () => {
    const socket = createSocketClient();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
      });

      return <Text>{toTranscriptText(latestSession)}</Text>;
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      socket.emit({ type: "transcription", text: "how are you" });
      socket.emit({ type: "response", text: "У вас" });
      socket.emit({
        type: "response",
        text: "У вас усё добра? Я чую, што вы нешта расказваеце.",
      });
    });

    expect(readRenderedText(renderer)).toBe(
      "user:how are you | assistant:У вас усё добра? Я чую, што вы нешта расказваеце.",
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it("keeps a user voice turn visible when transcription is missing", async () => {
    const socket = createSocketClient();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
      });

      return <Text>{toTranscriptText(latestSession)}</Text>;
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      socket.emit({ type: "processing" });
      socket.emit({
        type: "response",
        text: "Добра, давайце пагаворым пра нешта іншае.",
      });
    });

    expect(readRenderedText(renderer)).toContain("user:Галасавое паведамленне");
    expect(readRenderedText(renderer)).toContain(
      "assistant:Добра, давайце пагаворым пра нешта іншае.",
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it("replaces the pending voice turn with transcription when it arrives", async () => {
    const socket = createSocketClient();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
      });

      return <Text>{toTranscriptText(latestSession)}</Text>;
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      socket.emit({ type: "processing" });
      socket.emit({ type: "transcription", text: "пра нешта іншае" });
      socket.emit({
        type: "response",
        text: "Добра, давайце пагаворым пра нешта іншае.",
      });
    });

    expect(readRenderedText(renderer)).not.toContain("Галасавое паведамленне");
    expect(readRenderedText(renderer)).toContain("user:пра нешта іншае");

    await act(async () => {
      renderer.unmount();
    });
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
      socket.emit({
        type: "voice_config",
        sample_rate: 1000,
        playback_min_buffer_ms: 0,
        playback_empty_grace_ms: 120,
      });
      socket.emit({ type: "audio", bytes: createLocalPcmFrame(1000) });
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).not.toHaveBeenCalled();

    const oldMetering = recorder.start.mock.calls[0][0] as (db: number) => void;
    await act(async () => {
      [
        -32.2, -33.43, -35.69, -34.1, -33.8, -34.4, -35.2, -34.7, -33.9, -35.1,
        -34.8, -35.4,
      ].forEach(oldMetering);
      [-45, -45, -45].forEach(oldMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1120);
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(2);

    const freshMetering = recorder.start.mock.calls[1][0] as (
      db: number,
    ) => void;
    await act(async () => {
      [
        -32.2, -33.43, -35.69, -34.1, -33.8, -34.4, -35.2, -34.7, -33.9, -35.1,
        -34.8, -35.4,
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

  it("does not restart VAD until the streamed PCM queue drains", async () => {
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
      socket.emit({
        type: "voice_config",
        sample_rate: 1000,
        playback_min_buffer_ms: 0,
        playback_empty_grace_ms: 120,
      });
      socket.emit({ type: "audio", bytes: createLocalPcmFrame(1000) });
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      socket.emit({ type: "audio", bytes: createLocalPcmFrame(1000) });
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(recorder.start).toHaveBeenCalledTimes(2);

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

  it("connects the voice socket before starting VAD listening", async () => {
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
      });

      return (
        <Text>{latestSession.error ?? latestSession.connectionStatus}</Text>
      );
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.startListening();
    });

    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it("does not start VAD listening when voice socket connect fails", async () => {
    const socket = createSocketClient();
    (socket.connect as jest.Mock).mockRejectedValue(
      new Error("Voice socket connection failed."),
    );
    const recorder = createRecorder();
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
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
      await latestSession?.startListening();
    });

    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(recorder.start).not.toHaveBeenCalled();
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

  it("leaves processing with an error when the connected socket closes unexpectedly", async () => {
    const socket = createSocketClient();
    let closeUnexpectedly: ((reason?: string) => void) | undefined;
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: (socketOptions) => {
          closeUnexpectedly = socketOptions.onUnexpectedClose;
          return socket;
        },
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
      socket.emit({ type: "processing" });
    });

    expect(readRenderedText(renderer)).toContain("processing");

    await act(async () => {
      closeUnexpectedly?.("Connection reset");
    });

    expect(readRenderedText(renderer)).toContain("Connection reset");
  });

  it("clears active teacher lesson state when the teacher socket closes unexpectedly", async () => {
    const socket = createSocketClient();
    const teacherMode = {
      ...mockTeacherMode,
      isActive: true,
      stopLesson: jest.fn(),
    };
    let closeUnexpectedly: ((reason?: string) => void) | undefined;
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: teacherMode as never,
        sessionKind: "teacher",
        socketClientFactory: (socketOptions) => {
          closeUnexpectedly = socketOptions.onUnexpectedClose;
          return socket;
        },
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
      closeUnexpectedly?.("Connection reset");
    });

    expect(teacherMode.stopLesson).toHaveBeenCalledTimes(1);
    expect(readRenderedText(renderer)).toContain("Connection reset");
  });

  it("shows a recoverable error when interrupt is requested after the socket is gone", async () => {
    const socket = createSocketClient();
    (socket.sendInterrupt as jest.Mock).mockImplementation(() => {
      throw new Error("Voice socket is not connected.");
    });
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
      await latestSession?.interrupt();
    });

    expect(readRenderedText(renderer)).toContain(
      "Voice socket is not connected.",
    );
  });

  it("keeps the session idle when a stale connect resolves after disconnect", async () => {
    const socket = createSocketClient();
    const connectResult = createDeferred<void>();
    (socket.connect as jest.Mock).mockReturnValue(connectResult.promise);
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
      });

      return <Text>{latestSession.status}</Text>;
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    let connectPromise!: Promise<void>;
    await act(async () => {
      connectPromise = latestSession!.connect();
      latestSession!.disconnect();
      connectResult.resolve(undefined);
      await connectPromise;
    });

    expect(readRenderedText(renderer)).toBe("idle");
  });

  it("disconnects the socket and stops local voice activity", async () => {
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

      return <Text>{latestSession.status}</Text>;
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      await latestSession?.startListening();
      latestSession?.disconnect();
    });

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(playback.stop).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(readRenderedText(renderer)).toBe("idle");

    await act(async () => {
      renderer.unmount();
    });
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
        -32.2, -33.43, -35.69, -34.1, -33.8, -34.4, -35.2, -34.7, -33.9, -35.1,
        -34.8, -35.4,
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

  it("does not start another live audio stream when listening is already active", async () => {
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
      });

      return <Text>{latestSession.status}</Text>;
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await latestSession?.connect();
      await latestSession?.startListening();
      await latestSession?.startListening();
    });

    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it("drops an in-flight VAD segment when listening is stopped before recorder stop resolves", async () => {
    const socket = createSocketClient();
    const recorder = createRecorder();
    const stopResult = createDeferred<{
      uri: string;
      wavBytes: Uint8Array;
    }>();
    recorder.stop.mockReturnValue(stopResult.promise);
    let latestSession: ReturnType<typeof useVoiceSession> | null = null;

    function Probe() {
      latestSession = useVoiceSession({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        teacherMode: mockTeacherMode as never,
        socketClientFactory: () => socket,
        recording: recorder as never,
        vadConfig: {
          preferNativeTenVad: false,
          positiveSpeechThreshold: -45,
          negativeSpeechThreshold: -48,
          minSpeechFrames: 2,
          redemptionFrames: 2,
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
      [-58, -57, -56].forEach(onMetering);
      [-42, -41].forEach(onMetering);
      [-50, -51].forEach(onMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestSession?.stopListening();
      stopResult.resolve({
        uri: "file:///tmp/voice.wav",
        wavBytes: new Uint8Array([1, 2, 3]),
      });
      await stopResult.promise;
      await Promise.resolve();
    });

    expect(socket.sendAudio).not.toHaveBeenCalled();
  });

  it("submits a short phrase when it rises above the measured background level", async () => {
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
          preferNativeTenVad: false,
          positiveSpeechThreshold: -45,
          negativeSpeechThreshold: -48,
          minSpeechFrames: 2,
          redemptionFrames: 2,
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
      [-58, -57, -56, -57, -58].forEach(onMetering);
      [-43, -42.5].forEach(onMetering);
      [-50, -51].forEach(onMetering);
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(socket.sendAudio).toHaveBeenCalledWith({
      wavBytes: new Uint8Array([1, 2, 3]),
    });
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
