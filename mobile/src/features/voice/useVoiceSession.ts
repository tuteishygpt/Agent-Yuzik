import { useEffect, useState, useRef } from "react";

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
    | "reconnected"
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

const RESUME_AFTER_RESPONSE_MS = 900;
const RESUME_AFTER_AUDIO_IDLE_MS = 900;
const CLIENT_PLAYBACK_MIN_BUFFER_MS = 480;
const MIN_SUBMIT_SEGMENT_FRAMES = 10;
const MIN_SUBMIT_PEAK_DB = -36;

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

type VadSegmentStats = {
  active: boolean;
  frames: number;
  peakDb: number;
};

export function useVoiceSession(
  options: VoiceSessionOptions = {},
): VoiceSession {
  const teacherModeFromHook = useTeacherMode();
  const teacherMode = options.teacherMode ?? teacherModeFromHook;
  const [state, setState] = useState<VoiceSessionState>(initialState);
  const stateRef = useRef<VoiceSessionState>(initialState);
  const resumeListeningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const latestVadDbRef = useRef(-160);
  const speechSegmentRef = useRef<VadSegmentStats>({
    active: false,
    frames: 0,
    peakDb: -160,
  });
  const vadRecordingActiveRef = useRef(false);
  const vadRestartingRef = useRef(false);

  const recording = useVoiceRecording(options.recording);
  const playback = useVoicePlayback(options.playback);
  const vad = useVoiceVad(options.vadConfig);

  function update(
    updater: (current: VoiceSessionState) => VoiceSessionState,
  ) {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  }

  function appendTranscript(entry: VoiceTranscriptEntry) {
    update((s) => ({ ...s, transcript: [...s.transcript, entry] }));
  }

  function resetSpeechSegment(active = false) {
    speechSegmentRef.current = {
      active,
      frames: 0,
      peakDb: latestVadDbRef.current,
    };
  }

  function feedVadMeteringFrame(db: number) {
    latestVadDbRef.current = db;
    vad.feedMeteringFrame(db);

    const segment = speechSegmentRef.current;
    if (segment.active) {
      segment.frames += 1;
      segment.peakDb = Math.max(segment.peakDb, db);
    }
  }

  function shouldSubmitSpeechSegment(segment: VadSegmentStats) {
    return (
      segment.frames >= MIN_SUBMIT_SEGMENT_FRAMES &&
      segment.peakDb >= MIN_SUBMIT_PEAK_DB
    );
  }

  function handleSpeechStart() {
    console.log("[VoiceSession] VAD: speech start");
    resetSpeechSegment(true);
    update((s) => ({ ...s, isRecording: true }));
  }

  function handleSpeechEnd() {
    vad.stop();
    const completedSegment = { ...speechSegmentRef.current };
    resetSpeechSegment(false);
    update((s) => ({ ...s, isRecording: false }));

    if (stateRef.current.isPlaying) {
      return;
    }

    void stopVadRecording()
      .then((result) => {
        if (result.wavBytes && shouldSubmitSpeechSegment(completedSegment)) {
          if (!socket.isConnected()) {
            update((s) => ({
              ...s,
              connectionStatus: "error",
              error: "Voice socket disconnected before audio could be sent.",
            }));
            return;
          }
          try {
            update((s) => ({ ...s, connectionStatus: "processing" }));
            socket.sendAudio({ wavBytes: result.wavBytes });
          } catch (error) {
            const msg = toErrorMessage(error);
            update((s) => ({
              ...s,
              connectionStatus: "error",
              error: msg,
            }));
          }
          return;
        }
        update((s) => ({ ...s, connectionStatus: "connected" }));
        scheduleResumeListening(RESUME_AFTER_RESPONSE_MS);
      })
      .catch((error: unknown) => {
        const msg = toErrorMessage(error);
        update((s) => ({
          ...s,
          connectionStatus: "error",
          error: msg,
          isRecording: false,
        }));
      });
  }

  function startVadSession() {
    resetSpeechSegment(false);
    vad.start(handleSpeechStart, handleSpeechEnd);
  }

  function stopVadSession() {
    vad.stop();
    resetSpeechSegment(false);
  }

  function startVadRecording() {
    return recording.start((db) => feedVadMeteringFrame(db)).then(() => {
      vadRecordingActiveRef.current = true;
    });
  }

  function stopVadRecording() {
    if (!vadRecordingActiveRef.current) {
      return Promise.resolve({ wavBytes: null });
    }

    vadRecordingActiveRef.current = false;
    return recording
      .stop()
      .catch(() => ({ wavBytes: null }) as { wavBytes: null });
  }

  function suspendVadRecording() {
    stopVadSession();
    update((s) => ({ ...s, isRecording: false }));
    void stopVadRecording();
  }

  function clearResumeListeningTimer() {
    if (resumeListeningTimerRef.current) {
      clearTimeout(resumeListeningTimerRef.current);
      resumeListeningTimerRef.current = null;
    }
  }

  function scheduleResumeListening(delayMs: number) {
    clearResumeListeningTimer();
    resumeListeningTimerRef.current = setTimeout(() => {
      resumeListeningTimerRef.current = null;
      update((s) => ({ ...s, isPlaying: false, connectionStatus: "connected" }));
      if (stateRef.current.isListening) {
        startVadSession();
        void startVadRecording().catch((error: unknown) => {
          const msg = toErrorMessage(error);
          update((s) => ({ ...s, connectionStatus: "error", error: msg, isListening: false }));
        });
      }
    }, delayMs);
  }

  useEffect(() => clearResumeListeningTimer, []);

  function getPlaybackMinBufferMs(configuredMs: number | undefined): number {
    return configuredMs && configuredMs > 0
      ? configuredMs
      : CLIENT_PLAYBACK_MIN_BUFFER_MS;
  }

  function handleMessage(message: VoiceSocketMessage) {
    if (message.type === "audio") {
      if (vadRestartingRef.current) return;
      clearResumeListeningTimer();
      suspendVadRecording();
      update((s) => ({ ...s, isPlaying: true }));
      void playback
        .play(message.bytes, {
          sampleRate: stateRef.current.voiceConfig?.sample_rate,
          playbackMinBufferMs: getPlaybackMinBufferMs(
            stateRef.current.voiceConfig?.playback_min_buffer_ms,
          ),
        })
        .then(() => {
          scheduleResumeListening(RESUME_AFTER_AUDIO_IDLE_MS);
        })
        .catch((error: unknown) => {
          const msg = toErrorMessage(error);
          update((s) => ({
            ...s,
            connectionStatus: "error",
            error: msg,
            isPlaying: false,
          }));
          if (stateRef.current.isListening) {
            startVadSession();
            void startVadRecording().catch((e: unknown) => {
              update((s) => ({ ...s, connectionStatus: "error", error: toErrorMessage(e), isListening: false }));
            });
          }
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
      clearResumeListeningTimer();
      stopVadSession();
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
          ? "reconnected"
          : s.retryNotice,
      }));
      scheduleResumeListening(RESUME_AFTER_RESPONSE_MS);
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
      clearResumeListeningTimer();
      playback.stop();
      update((s) => ({ ...s, connectionStatus: "connected", isPlaying: false }));
      stopVadSession();
      if (stateRef.current.isListening) {
        vadRestartingRef.current = true;
        void stopVadRecording().then(() =>
          startVadRecording().then(() => {
            vadRestartingRef.current = false;
            startVadSession();
          }).catch((e: unknown) => {
            vadRestartingRef.current = false;
            update((s) => ({ ...s, connectionStatus: "error", error: toErrorMessage(e), isListening: false }));
          }),
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
          ? "reconnected"
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
      await startVadRecording();
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

    startVadSession();
  }

  function stopListening() {
    clearResumeListeningTimer();
    stopVadSession();
    void stopVadRecording();
    update((s) => ({ ...s, isListening: false, isRecording: false }));
  }

  async function interrupt() {
    clearResumeListeningTimer();
    playback.stop();
    socket.sendInterrupt();
    update((s) => ({ ...s, isPlaying: false, retryNotice: null }));
    stopVadSession();
    if (stateRef.current.isListening) {
      startVadSession();
      void stopVadRecording().then(() =>
        startVadRecording().catch((e: unknown) => {
          update((s) => ({ ...s, connectionStatus: "error", error: toErrorMessage(e), isListening: false }));
        }),
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
