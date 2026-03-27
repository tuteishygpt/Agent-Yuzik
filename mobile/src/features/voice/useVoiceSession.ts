import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { createVoicePlaybackAdapter, type VoicePlaybackAdapter } from "@/lib/audio-playback";
import {
  createDefaultVoiceRecorderAdapter,
  type VoiceRecorderAdapter,
} from "@/lib/audio-recording";
import {
  createVoiceSocketClient,
  type VoiceSocketClient,
  type VoiceSocketMessage,
} from "@/lib/voice-socket";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";

export type VoiceTranscriptEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export type VoiceSessionState = {
  connectionStatus:
    | "idle"
    | "connecting"
    | "connected"
    | "processing"
    | "reconnecting"
    | "reconnected, please retry"
    | "error";
  voiceConfig: VoiceSocketMessage | null;
  transcript: VoiceTranscriptEntry[];
  retryNotice: string | null;
  error: string | null;
  isRecording: boolean;
  isPlaying: boolean;
};

export type VoiceSessionOptions = {
  backendUrl?: string;
  getAccessToken?: () => Promise<string | null>;
  socketClientFactory?: (options: {
    url: string;
    getAccessToken: () => Promise<string | null>;
  }) => VoiceSocketClient;
  recording?: VoiceRecorderAdapter;
  playback?: VoicePlaybackAdapter;
  teacherMode?: ReturnType<typeof useTeacherMode>;
};

export type VoiceSession = VoiceSessionState & {
  status: VoiceSessionState["connectionStatus"];
  teacherSelection: {
    lessonId: string | null;
    stepId: string | null;
    prompt: string | null;
    active: boolean;
  };
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  interrupt: () => Promise<void>;
  startTeacherLesson: () => Promise<void>;
  stopTeacherLesson: () => Promise<void>;
};

const initialState: VoiceSessionState = {
  connectionStatus: "idle",
  voiceConfig: null,
  transcript: [],
  retryNotice: null,
  error: null,
  isRecording: false,
  isPlaying: false,
};

function createTranscriptEntry(
  role: VoiceTranscriptEntry["role"],
  text: string,
): VoiceTranscriptEntry {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
  };
}

function buildVoiceSocketUrl(backendUrl: string): string {
  const normalized = backendUrl.replace(/\/+$/, "");
  return normalized.replace(/^http/i, "ws") + "/api/voice";
}

function createStateUpdater(
  setState: Dispatch<SetStateAction<VoiceSessionState>>,
  stateRef: MutableRefObject<VoiceSessionState>,
) {
  return (updater: (current: VoiceSessionState) => VoiceSessionState) => {
    setState((current) => {
      const next = updater(current);
      stateRef.current = next;
      return next;
    });
  };
}

export function useVoiceSession(options: VoiceSessionOptions = {}): VoiceSession {
  const teacherModeFromHook = useTeacherMode();
  const teacherMode = options.teacherMode ?? teacherModeFromHook;
  const recordingRef = useRef<VoiceRecorderAdapter>(
    options.recording ?? createDefaultVoiceRecorderAdapter(),
  );
  const playbackRef = useRef<VoicePlaybackAdapter>(
    options.playback ?? createVoicePlaybackAdapter(),
  );
  const socketRef = useRef<VoiceSocketClient | null>(null);
  const stateRef = useRef<VoiceSessionState>(initialState);
  const [state, setState] = useState<VoiceSessionState>(initialState);

  const updateState = createStateUpdater(setState, stateRef);

  const appendTranscript = (entry: VoiceTranscriptEntry) => {
    updateState((current) => ({
      ...current,
      transcript: [...current.transcript, entry],
    }));
  };

  const resolveTeacherSelection = () => ({
    lessonId: teacherMode.selectedLesson?.id ?? null,
    stepId: teacherMode.selectedStep?.id ?? null,
    prompt: teacherMode.currentPrompt ?? null,
    active: teacherMode.isActive,
  });

  const handleSocketMessage = (message: VoiceSocketMessage) => {
    if (message.type === "audio") {
      void playbackRef.current.playBytes(message.bytes);
      updateState((current) => ({
        ...current,
        isPlaying: true,
      }));
      return;
    }

    if (message.type === "voice_config") {
      updateState((current) => ({
        ...current,
        connectionStatus: "connected",
        voiceConfig: message,
        error: null,
      }));
      return;
    }

    if (message.type === "processing") {
      appendTranscript(createTranscriptEntry("system", "processing"));
      updateState((current) => ({
        ...current,
        connectionStatus: "processing",
      }));
      return;
    }

    if (message.type === "transcription") {
      appendTranscript(createTranscriptEntry("user", message.text));
      return;
    }

    if (message.type === "response") {
      appendTranscript(createTranscriptEntry("assistant", message.text));
      updateState((current) => ({
        ...current,
        connectionStatus: "connected",
        retryNotice: message.fallback_reason
          ? "reconnected, please retry"
          : current.retryNotice,
      }));
      return;
    }

    if (message.type === "teacher_mode_started") {
      teacherMode.selectLesson?.(message.lesson_id);
      teacherMode.selectStep?.(message.step_id);
      teacherMode.setCurrentPrompt?.(message.prompt);
      teacherMode.startLesson?.({ sessionId: message.lesson_id });
      updateState((current) => ({
        ...current,
        connectionStatus: "connected",
      }));
      return;
    }

    if (message.type === "teacher_mode_stopped") {
      teacherMode.stopLesson?.();
      updateState((current) => ({
        ...current,
        connectionStatus: "connected",
      }));
      return;
    }

    if (message.type === "error") {
      updateState((current) => ({
        ...current,
        connectionStatus: "error",
        error: message.message,
      }));
      return;
    }

    if (message.type === "interruption_handshake") {
      playbackRef.current.stop();
      updateState((current) => ({
        ...current,
        connectionStatus: "connected",
        isPlaying: false,
      }));
    }
  };

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      playbackRef.current.release();
    };
  }, []);

  async function connect() {
    const backendUrl = options.backendUrl ?? getRuntimeEnv().backendUrl;
    const getAccessToken =
      options.getAccessToken ??
      (async () => (await getSupabaseSession())?.access_token ?? null);
    const socketFactory =
      options.socketClientFactory ??
      ((socketOptions) =>
        createVoiceSocketClient({
          ...socketOptions,
          url: buildVoiceSocketUrl(backendUrl),
        }));

    socketRef.current?.disconnect();

    updateState((current) => ({
      ...current,
      connectionStatus: "connecting",
      error: null,
    }));

    const socket = socketFactory({
      url: buildVoiceSocketUrl(backendUrl),
      getAccessToken,
    });

    socket.onMessage(handleSocketMessage);
    socketRef.current = socket;
    await socket.connect();

    updateState((current) => ({
      ...current,
      connectionStatus: "connected",
    }));
  }

  async function reconnect() {
    updateState((current) => ({
      ...current,
      connectionStatus: "reconnecting",
    }));

    await connect();

    updateState((current) => ({
      ...current,
      connectionStatus: "reconnected, please retry",
      retryNotice: "reconnected, please retry",
    }));
  }

  async function startRecording() {
    await recordingRef.current.prepare();
    recordingRef.current.start();

    updateState((current) => ({
      ...current,
      isRecording: true,
    }));
  }

  async function stopRecording() {
    const result = await recordingRef.current.stop();

    updateState((current) => ({
      ...current,
      isRecording: false,
    }));

    if (result.wavBytes) {
      socketRef.current?.sendAudio({
        wavBytes: result.wavBytes,
      });
    }
  }

  async function interrupt() {
    playbackRef.current.stop();
    socketRef.current?.sendInterrupt();
    updateState((current) => ({
      ...current,
      isPlaying: false,
      retryNotice: null,
    }));
  }

  async function startTeacherLesson() {
    const payload = teacherMode.createStartLessonPayload?.();

    if (!payload) {
      return;
    }

    teacherMode.startLesson?.({
      sessionId: teacherMode.selectedLesson?.id ?? null,
    });
    socketRef.current?.sendTeacherStartLesson(payload);
  }

  async function stopTeacherLesson() {
    const payload = teacherMode.createStopLessonPayload?.();

    if (!payload) {
      return;
    }

    socketRef.current?.sendTeacherStopLesson(payload);
    teacherMode.stopLesson?.();
  }

  return {
    ...state,
    status: state.connectionStatus,
    teacherSelection: resolveTeacherSelection(),
    connect,
    reconnect,
    startRecording,
    stopRecording,
    interrupt,
    startTeacherLesson,
    stopTeacherLesson,
  };
}
