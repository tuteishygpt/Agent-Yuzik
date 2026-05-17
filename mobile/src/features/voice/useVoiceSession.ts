import { useState, useRef } from "react";

import type {
  VoiceConfigMessage,
  VoiceSocketMessage,
  VoiceSocketClient,
} from "@/lib/voice-socket";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";
import type { VoicePlaybackAdapter } from "@/lib/audio-playback";
import type { VoiceRecorderAdapter } from "@/lib/audio-recording";
import type { VadConfig } from "@/lib/vad";
import { toErrorMessage } from "@/lib/errors";

import { useVoiceSocket, type VoiceSocketControls } from "./useVoiceSocket";
import { useVoiceRecording } from "./useVoiceRecording";
import { useVoicePlayback } from "./useVoicePlayback";
import { useVoiceVad } from "./useVoiceVad";

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
  voiceConfig: VoiceConfigMessage | null;
  transcript: VoiceTranscriptEntry[];
  retryNotice: string | null;
  error: string | null;
  isRecording: boolean;
  isListening: boolean;
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
  vadConfig?: Partial<VadConfig>;
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
  startListening: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => Promise<void>;
  startTeacherLesson: () => Promise<void>;
  stopTeacherLesson: () => Promise<void>;
};

const ANTI_ECHO_DELAY_MS = 350;

const initialState: VoiceSessionState = {
  connectionStatus: "idle",
  voiceConfig: null,
  transcript: [],
  retryNotice: null,
  error: null,
  isRecording: false,
  isListening: false,
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

export function useVoiceSession(
  options: VoiceSessionOptions = {},
): VoiceSession {
  const teacherModeFromHook = useTeacherMode();
  const teacherMode = options.teacherMode ?? teacherModeFromHook;
  const [state, setState] = useState<VoiceSessionState>(initialState);
  const stateRef = useRef<VoiceSessionState>(initialState);

  const recording = useVoiceRecording(options.recording);
  const playback = useVoicePlayback(options.playback);
  const vad = useVoiceVad(options.vadConfig);

  function update(
    updater: (current: VoiceSessionState) => VoiceSessionState,
  ) {
    setState((current) => {
      const next = updater(current);
      stateRef.current = next;
      return next;
    });
  }

  function appendTranscript(entry: VoiceTranscriptEntry) {
    update((s) => ({ ...s, transcript: [...s.transcript, entry] }));
  }

  function resumeAfterPlayback() {
    update((s) => ({ ...s, isPlaying: false, connectionStatus: "connected" }));
    setTimeout(() => {
      vad.resume();
      if (stateRef.current.isListening && !stateRef.current.isPlaying) {
        void recording.stop().catch(() => {}).then(() =>
          recording
            .start((db) => vad.feedMeteringFrame(db))
            .catch(() => {}),
        );
      }
    }, ANTI_ECHO_DELAY_MS);
  }

  function handleMessage(message: VoiceSocketMessage) {
    if (message.type === "audio") {
      vad.pause();
      update((s) => ({ ...s, isPlaying: true }));
      void playback
        .play(message.bytes, {
          sampleRate: stateRef.current.voiceConfig?.sample_rate,
        })
        .catch((error: unknown) => {
          const msg = toErrorMessage(error);
          update((s) => ({
            ...s,
            connectionStatus: "error",
            error: msg,
            isPlaying: false,
          }));
          vad.resume();
        });
      return;
    }

    if (message.type === "voice_config") {
      update((s) => ({
        ...s,
        connectionStatus: "connected",
        voiceConfig: message,
        error: null,
      }));
      return;
    }

    if (message.type === "processing") {
      vad.pause();
      appendTranscript(createTranscriptEntry("system", "processing"));
      update((s) => ({ ...s, connectionStatus: "processing" }));
      return;
    }

    if (message.type === "transcription") {
      appendTranscript(createTranscriptEntry("user", message.text));
      return;
    }

    if (message.type === "response") {
      appendTranscript(createTranscriptEntry("assistant", message.text));
      update((s) => ({
        ...s,
        connectionStatus: "connected",
        retryNotice: message.fallback_reason
          ? "reconnected, please retry"
          : s.retryNotice,
      }));
      resumeAfterPlayback();
      return;
    }

    if (message.type === "teacher_mode_started") {
      teacherMode.selectLesson?.(message.lesson_id);
      teacherMode.selectStep?.(message.step_id);
      teacherMode.setCurrentPrompt?.(message.prompt);
      teacherMode.startLesson?.({ sessionId: message.lesson_id });
      update((s) => ({ ...s, connectionStatus: "connected" }));
      return;
    }

    if (message.type === "teacher_mode_stopped") {
      teacherMode.stopLesson?.();
      update((s) => ({ ...s, connectionStatus: "connected" }));
      return;
    }

    if (message.type === "error") {
      update((s) => ({
        ...s,
        connectionStatus: "error",
        error: message.message,
      }));
      return;
    }

    if (message.type === "interruption_handshake") {
      playback.stop();
      update((s) => ({ ...s, connectionStatus: "connected", isPlaying: false }));
      vad.resume();
      if (stateRef.current.isListening) {
        void recording.stop().catch(() => {}).then(() =>
          recording
            .start((db) => vad.feedMeteringFrame(db))
            .catch(() => {}),
        );
      }
    }
  }

  function handleStatusChange(
    status: "idle" | "connecting" | "connected" | "reconnecting" | "error",
    error?: string,
  ) {
    update((s) => ({
      ...s,
      connectionStatus: status,
      error: error ?? (status === "error" ? s.error : null),
      retryNotice:
        status === "connected" && s.connectionStatus === "reconnecting"
          ? "reconnected, please retry"
          : s.retryNotice,
    }));
  }

  const socket: VoiceSocketControls = useVoiceSocket(
    options,
    handleMessage,
    handleStatusChange,
  );

  async function connect() {
    await socket.connect();
  }

  async function reconnect() {
    await socket.reconnect();
  }

  async function startRecording() {
    try {
      await recording.start();
    } catch (error) {
      const msg = toErrorMessage(error);
      update((s) => ({
        ...s,
        connectionStatus: "error",
        error: msg,
        isRecording: false,
      }));
      return;
    }
    update((s) => ({ ...s, isRecording: true }));
  }

  async function stopRecording() {
    update((s) => ({ ...s, isRecording: false }));
    try {
      const result = await recording.stop();
      if (result.wavBytes) {
        socket.sendAudio({ wavBytes: result.wavBytes });
      }
    } catch {}
  }

  async function startListening() {
    try {
      await recording.start((db) => vad.feedMeteringFrame(db));
    } catch (error) {
      const msg = toErrorMessage(error);
      update((s) => ({
        ...s,
        connectionStatus: "error",
        error: msg,
        isListening: false,
      }));
      return;
    }

    update((s) => ({ ...s, isListening: true }));
    console.log("[VoiceSession] startListening: recording started, VAD starting");

    vad.start(
      () => {
        console.log("[VoiceSession] VAD: speech start");
        update((s) => ({ ...s, isRecording: true }));
      },
      () => {
        update((s) => ({ ...s, isRecording: false }));

        if (stateRef.current.isPlaying) {
          return;
        }

        void recording
          .stop()
          .catch(() => ({ wavBytes: null }) as { wavBytes: null })
          .then((result) => {
            if (result.wavBytes) {
              socket.sendAudio({ wavBytes: result.wavBytes });
            }
            const s = stateRef.current;
            if (s.isListening && !s.isPlaying && s.connectionStatus !== "processing") {
              recording
                .start((db) => vad.feedMeteringFrame(db))
                .catch(() => {});
            }
          });
      },
    );
  }

  function stopListening() {
    vad.stop();
    void recording.stop();
    update((s) => ({ ...s, isListening: false, isRecording: false }));
  }

  async function interrupt() {
    playback.stop();
    socket.sendInterrupt();
    update((s) => ({ ...s, isPlaying: false, retryNotice: null }));
    vad.resume();
    if (stateRef.current.isListening) {
      void recording.stop().catch(() => {}).then(() =>
        recording
          .start((db) => vad.feedMeteringFrame(db))
          .catch(() => {}),
      );
    }
  }

  async function startTeacherLesson() {
    const payload = teacherMode.createStartLessonPayload?.();
    if (!payload) return;
    try {
      socket.sendTeacherStartLesson(payload);
      teacherMode.startLesson?.({
        sessionId: teacherMode.selectedLesson?.id ?? null,
      });
    } catch (error) {
      const msg = toErrorMessage(error);
      update((s) => ({ ...s, connectionStatus: "error", error: msg }));
    }
  }

  async function stopTeacherLesson() {
    const payload = teacherMode.createStopLessonPayload?.();
    if (!payload) return;
    try {
      socket.sendTeacherStopLesson(payload);
      teacherMode.stopLesson?.();
    } catch (error) {
      const msg = toErrorMessage(error);
      update((s) => ({ ...s, connectionStatus: "error", error: msg }));
    }
  }

  return {
    ...state,
    status: state.connectionStatus,
    teacherSelection: {
      lessonId: teacherMode.selectedLesson?.id ?? null,
      stepId: teacherMode.selectedStep?.id ?? null,
      prompt: teacherMode.currentPrompt ?? null,
      active: teacherMode.isActive,
    },
    connect,
    reconnect,
    startRecording,
    stopRecording,
    startListening,
    stopListening,
    interrupt,
    startTeacherLesson,
    stopTeacherLesson,
  };
}
