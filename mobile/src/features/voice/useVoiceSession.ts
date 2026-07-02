import { useEffect, useState, useRef } from "react";
import { Platform } from "react-native";

import type {
  VoiceConfigMessage,
  VoiceSocketMessage,
  VoiceSocketClient,
} from "@/lib/voice-socket";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";
import type { TeacherModeController } from "@/features/teacher/teacher-types";
import type {
  VoicePlaybackAdapter,
  VoicePlaybackDebugEvent,
} from "@/lib/audio-playback";
import type { VoiceRecorderAdapter } from "@/lib/audio-recording";
import {
  DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS,
  getLocalPcmSampleCount,
  isLocalPcmFrame,
} from "@/lib/audio-pcm-format";
import { DEFAULT_VAD_CONFIG, type VadConfig } from "@/lib/vad";
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
  diagnostics: string | null;
  isRecording: boolean;
  isListening: boolean;
  isPlaying: boolean;
};

export type VoiceSessionOptions = {
  backendUrl?: string;
  sessionKind?: "voice" | "teacher";
  getAccessToken?: () => Promise<string | null>;
  socketClientFactory?: (options: {
    url: string;
    getAccessToken: () => Promise<string | null>;
    getInstallId?: () => Promise<string | null>;
    onUnexpectedClose?: (reason?: string) => void;
  }) => VoiceSocketClient;
  recording?: VoiceRecorderAdapter;
  playback?: VoicePlaybackAdapter;
  teacherMode?: TeacherModeController | null;
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
  disconnect: () => void;
};

const RESUME_AFTER_RESPONSE_MS = 900;
const IOS_WEB_HTML_RESUME_AFTER_RESPONSE_MS = 7000;
const NON_STREAMING_AUDIO_IDLE_FALLBACK_MS = 900;
const CLIENT_PLAYBACK_MIN_BUFFER_MS = 1200;
const MICROPHONE_FRAME_TIMEOUT_MS = 2000;
const NO_MICROPHONE_AUDIO_ERROR =
  "No microphone audio was received. Check browser microphone permissions and selected input device.";
const PENDING_VOICE_TRANSCRIPT_TEXT = "Галасавое паведамленне";
const WEB_VAD_CONFIG: Partial<VadConfig> = {
  positiveSpeechThreshold: -55,
  negativeSpeechThreshold: -60,
  minSpeechFrames: 2,
  redemptionFrames: 5,
};

export type VoiceDiagnostics = {
  frames: number;
  lastDb: number;
  peakDb: number;
  speechStartCount: number;
  speechEndCount: number;
  sendAudioCount: number;
  totalAudioBytes: number;
  receivedAudioCount: number;
  receivedAudioBytes: number;
  playbackStartCount: number;
  playbackErrorCount: number;
  lastPlaybackDebug: string | null;
  lastEvent: string;
};

export type VoiceDiagnosticEvent =
  | { type: "meter"; db: number }
  | { type: "speech_start" }
  | { type: "speech_end" }
  | { type: "send_audio"; bytes: number }
  | { type: "receive_audio"; bytes: number }
  | { type: "playback_start" }
  | { type: "playback_error" }
  | { type: "playback_debug"; message: string }
  | { type: "no_microphone_frames" }
  | { type: "start_listening" }
  | { type: "stop_listening" };

export function createInitialVoiceDiagnostics(): VoiceDiagnostics {
  return {
    frames: 0,
    lastDb: -160,
    peakDb: -160,
    speechStartCount: 0,
    speechEndCount: 0,
    sendAudioCount: 0,
    totalAudioBytes: 0,
    receivedAudioCount: 0,
    receivedAudioBytes: 0,
    playbackStartCount: 0,
    playbackErrorCount: 0,
    lastPlaybackDebug: null,
    lastEvent: "idle",
  };
}

function formatDiagnosticDb(db: number): string {
  return Number.isFinite(db) ? db.toFixed(1) : "n/a";
}

function formatPlaybackDebugEvent(event: VoicePlaybackDebugEvent): string {
  if (event.type === "web_html_start") {
    return `html,start,bytes=${event.bytes}`;
  }

  if (event.type === "web_html_end") {
    return "html,end";
  }

  if (event.type === "web_pcm_end") {
    return [
      `end`,
      `st=${event.contextState}`,
      `t=${event.currentTime.toFixed(2)}`,
      `left=${event.remainingSources}`,
    ].join(",");
  }

  return [
    `pcm`,
    `st=${event.contextStateBefore}>${event.contextStateAfter}`,
    `ctx=${Math.round(event.contextSampleRate)}`,
    `src=${Math.round(event.frameSampleRate)}`,
    `n=${event.samples}`,
    `db=${formatDiagnosticDb(event.rmsDb)}`,
    `pk=${event.peak.toFixed(3)}`,
    `now=${event.currentTime.toFixed(2)}`,
    `at=${event.startAt.toFixed(2)}`,
    `q=${event.queueEndAt.toFixed(2)}`,
    `mb=${event.minBufferMs}`,
  ].join(",");
}

export function updateVoiceDiagnostics(
  current: VoiceDiagnostics,
  event: VoiceDiagnosticEvent,
): VoiceDiagnostics {
  switch (event.type) {
    case "meter":
      return {
        ...current,
        frames: current.frames + 1,
        lastDb: event.db,
        peakDb: Math.max(current.peakDb, event.db),
        lastEvent: "meter",
      };
    case "speech_start":
      return {
        ...current,
        speechStartCount: current.speechStartCount + 1,
        lastEvent: "speechStart",
      };
    case "speech_end":
      return {
        ...current,
        speechEndCount: current.speechEndCount + 1,
        lastEvent: "speechEnd",
      };
    case "send_audio":
      return {
        ...current,
        sendAudioCount: current.sendAudioCount + 1,
        totalAudioBytes: current.totalAudioBytes + event.bytes,
        lastEvent: "sendAudio",
      };
    case "receive_audio":
      return {
        ...current,
        receivedAudioCount: current.receivedAudioCount + 1,
        receivedAudioBytes: current.receivedAudioBytes + event.bytes,
        lastEvent: "audioRecv",
      };
    case "playback_start":
      return {
        ...current,
        playbackStartCount: current.playbackStartCount + 1,
        lastEvent: "playStart",
      };
    case "playback_error":
      return {
        ...current,
        playbackErrorCount: current.playbackErrorCount + 1,
        lastEvent: "playError",
      };
    case "playback_debug":
      return {
        ...current,
        lastPlaybackDebug: event.message,
        lastEvent: "playDbg",
      };
    case "no_microphone_frames":
      return {
        ...current,
        lastEvent: "noFrames",
      };
    case "start_listening":
      return {
        ...current,
        lastEvent: "start",
      };
    case "stop_listening":
      return {
        ...current,
        lastEvent: "stop",
      };
  }
}

export function formatVoiceDiagnostics(diagnostics: VoiceDiagnostics): string {
  const parts = [
    `diag frames=${diagnostics.frames}`,
    `db=${formatDiagnosticDb(diagnostics.lastDb)}`,
    `peak=${formatDiagnosticDb(diagnostics.peakDb)}`,
    `speechStart=${diagnostics.speechStartCount}`,
    `speechEnd=${diagnostics.speechEndCount}`,
    `sendAudio=${diagnostics.sendAudioCount}`,
    `sentBytes=${diagnostics.totalAudioBytes}`,
    `audioRecv=${diagnostics.receivedAudioCount}`,
    `recvBytes=${diagnostics.receivedAudioBytes}`,
    `playStart=${diagnostics.playbackStartCount}`,
    `playError=${diagnostics.playbackErrorCount}`,
    `last=${diagnostics.lastEvent}`,
  ];

  if (diagnostics.lastPlaybackDebug) {
    parts.push(`pb=${diagnostics.lastPlaybackDebug}`);
  }

  return parts.join(" ");
}

const initialState: VoiceSessionState = {
  connectionStatus: "idle",
  voiceConfig: null,
  transcript: [],
  retryNotice: null,
  error: null,
  diagnostics: null,
  isRecording: false,
  isListening: false,
  isPlaying: false,
};

const disabledTeacherMode: TeacherModeController = {
  lessons: [],
  selectedLesson: null,
  selectedStep: null,
  currentPrompt: null,
  activeLessonId: null,
  activeSessionId: null,
  isActive: false,
  isLoading: false,
  error: null,
  getSnapshot: () => ({
    lessons: [],
    selectedLesson: null,
    selectedStep: null,
    currentPrompt: null,
    activeLessonId: null,
    activeSessionId: null,
    isActive: false,
    isLoading: false,
    error: null,
  }),
  loadLessons: async () => undefined,
  selectLesson: () => undefined,
  selectStep: () => undefined,
  setCurrentPrompt: () => undefined,
  setActiveSession: () => undefined,
  startLesson: () => null,
  stopLesson: () => null,
  createStartLessonPayload: () => null,
  createStopLessonPayload: () => null,
};

function resolveVadConfig(config?: Partial<VadConfig>): VadConfig {
  return {
    ...DEFAULT_VAD_CONFIG,
    ...(Platform.OS === "web" ? WEB_VAD_CONFIG : null),
    ...config,
  };
}

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

type BackgroundLevelStats = {
  samples: number;
  meanDb: number;
};

export function useVoiceSession(
  options: VoiceSessionOptions = {},
): VoiceSession {
  const teacherModeFromHook = useTeacherMode();
  const teacherMode =
    options.teacherMode === null
      ? disabledTeacherMode
      : (options.teacherMode ?? teacherModeFromHook);
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
  const vadRecordingStartInFlightRef = useRef<Promise<void> | null>(null);
  const listeningStartInFlightRef = useRef<Promise<void> | null>(null);
  const voiceActivityGenerationRef = useRef(0);
  const vadRestartingRef = useRef(false);
  const htmlPlaybackActiveRef = useRef(false);
  const playbackSequenceRef = useRef(0);
  const playbackQueueEndAtRef = useRef(0);
  const playbackInputReadyRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingUserTranscriptIdRef = useRef<string | null>(null);
  const microphoneFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const microphoneFrameCountRef = useRef(0);
  const voiceDiagnosticsRef = useRef<VoiceDiagnostics>(
    createInitialVoiceDiagnostics(),
  );
  const backgroundLevelRef = useRef<BackgroundLevelStats>({
    samples: 0,
    meanDb: -160,
  });

  const recording = useVoiceRecording(options.recording);
  const playback = useVoicePlayback(options.playback);
  const vadConfig = resolveVadConfig(options.vadConfig);
  const vad = useVoiceVad(vadConfig);

  function update(updater: (current: VoiceSessionState) => VoiceSessionState) {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  }

  function appendTranscript(entry: VoiceTranscriptEntry) {
    update((s) => ({ ...s, transcript: [...s.transcript, entry] }));
  }

  function publishVoiceDiagnostic(event: VoiceDiagnosticEvent) {
    const next = updateVoiceDiagnostics(voiceDiagnosticsRef.current, event);
    voiceDiagnosticsRef.current = next;
    const diagnostics = formatVoiceDiagnostics(next);
    console.log(`[VoiceDiag] ${diagnostics}`);
    update((s) => ({ ...s, diagnostics }));
  }

  function handlePlaybackDebug(event: VoicePlaybackDebugEvent) {
    publishVoiceDiagnostic({
      type: "playback_debug",
      message: formatPlaybackDebugEvent(event),
    });

    if (event.type === "web_html_start") {
      htmlPlaybackActiveRef.current = true;
      clearResumeListeningTimer();
      return;
    }

    if (event.type === "web_html_end") {
      htmlPlaybackActiveRef.current = false;
      if (stateRef.current.isListening) {
        scheduleResumeListening(IOS_WEB_HTML_RESUME_AFTER_RESPONSE_MS);
      }
    }
  }

  function resetVoiceDiagnostics(event: VoiceDiagnosticEvent) {
    voiceDiagnosticsRef.current = updateVoiceDiagnostics(
      createInitialVoiceDiagnostics(),
      event,
    );
    const diagnostics = formatVoiceDiagnostics(voiceDiagnosticsRef.current);
    console.log(`[VoiceDiag] ${diagnostics}`);
    update((s) => ({ ...s, diagnostics }));
  }

  function appendPendingUserTranscript() {
    const entry = createTranscriptEntry("user", PENDING_VOICE_TRANSCRIPT_TEXT);
    pendingUserTranscriptIdRef.current = entry.id;
    appendTranscript(entry);
  }

  function replacePendingUserTranscript(text: string) {
    const pendingId = pendingUserTranscriptIdRef.current;

    if (!pendingId) {
      appendTranscript(createTranscriptEntry("user", text));
      return;
    }

    update((s) => {
      let replaced = false;
      const transcript = s.transcript.map((entry) => {
        if (entry.id !== pendingId) {
          return entry;
        }

        replaced = true;
        return {
          ...entry,
          text,
        };
      });

      if (!replaced) {
        return {
          ...s,
          transcript: [...s.transcript, createTranscriptEntry("user", text)],
        };
      }

      return { ...s, transcript };
    });
    pendingUserTranscriptIdRef.current = null;
  }

  function upsertAssistantTranscript(text: string) {
    update((s) => {
      const transcript = [...s.transcript];
      const lastEntry = transcript[transcript.length - 1];

      if (lastEntry?.role === "assistant") {
        transcript[transcript.length - 1] = {
          ...lastEntry,
          text,
        };
        return { ...s, transcript };
      }

      return {
        ...s,
        transcript: [...s.transcript, createTranscriptEntry("assistant", text)],
      };
    });
  }

  function resetSpeechSegment(active = false) {
    speechSegmentRef.current = {
      active,
      frames: 0,
      peakDb: latestVadDbRef.current,
    };
  }

  function updateBackgroundLevel(db: number) {
    if (!Number.isFinite(db) || db >= vadConfig.positiveSpeechThreshold) {
      return;
    }

    const current = backgroundLevelRef.current;
    const samples = current.samples + 1;
    const meanDb = current.meanDb + (db - current.meanDb) / samples;
    backgroundLevelRef.current = { samples, meanDb };
  }

  function getSubmitProminenceDb() {
    return Math.abs(
      vadConfig.positiveSpeechThreshold - vadConfig.negativeSpeechThreshold,
    );
  }

  function getBackgroundLevelDb() {
    const background = backgroundLevelRef.current;
    return background.samples > 0 ? background.meanDb : null;
  }

  function feedVadMeteringFrame(db: number, pcm16?: Uint8Array) {
    microphoneFrameCountRef.current += 1;
    clearMicrophoneFrameWatchdog();
    latestVadDbRef.current = db;
    publishVoiceDiagnostic({ type: "meter", db });

    const segment = speechSegmentRef.current;
    if (segment.active) {
      segment.frames += 1;
      segment.peakDb = Math.max(segment.peakDb, db);
    } else {
      updateBackgroundLevel(db);
    }

    vad.feedMeteringFrame(db, pcm16);
  }

  function clearMicrophoneFrameWatchdog() {
    if (microphoneFrameTimerRef.current) {
      clearTimeout(microphoneFrameTimerRef.current);
      microphoneFrameTimerRef.current = null;
    }
  }

  function scheduleMicrophoneFrameWatchdog() {
    clearMicrophoneFrameWatchdog();
    microphoneFrameTimerRef.current = setTimeout(() => {
      microphoneFrameTimerRef.current = null;

      if (
        !stateRef.current.isListening ||
        !vadRecordingActiveRef.current ||
        microphoneFrameCountRef.current > 0
      ) {
        return;
      }

      voiceActivityGenerationRef.current += 1;
      publishVoiceDiagnostic({ type: "no_microphone_frames" });
      stopVadSession();
      void stopVadRecording();
      update((s) => ({
        ...s,
        connectionStatus: "error",
        error: NO_MICROPHONE_AUDIO_ERROR,
        isListening: false,
        isRecording: false,
      }));
    }, MICROPHONE_FRAME_TIMEOUT_MS);
  }

  function shouldSubmitSpeechSegment(segment: VadSegmentStats) {
    const prominenceDb = getSubmitProminenceDb();
    const backgroundDb = getBackgroundLevelDb();

    if (backgroundDb === null) {
      return segment.peakDb >= vadConfig.positiveSpeechThreshold + prominenceDb;
    }

    return segment.peakDb >= backgroundDb + prominenceDb;
  }

  function handleSpeechStart() {
    resetSpeechSegment(true);
    publishVoiceDiagnostic({ type: "speech_start" });
    update((s) => ({ ...s, isRecording: true }));
  }

  function handleSpeechEnd() {
    const voiceActivityGeneration = voiceActivityGenerationRef.current;
    vad.stop();
    const completedSegment = { ...speechSegmentRef.current };
    resetSpeechSegment(false);
    publishVoiceDiagnostic({ type: "speech_end" });
    update((s) => ({ ...s, isRecording: false }));

    if (stateRef.current.isPlaying) {
      return;
    }

    void stopVadRecording()
      .then((result) => {
        if (voiceActivityGeneration !== voiceActivityGenerationRef.current) {
          return;
        }

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
            publishVoiceDiagnostic({
              type: "send_audio",
              bytes: result.wavBytes.byteLength,
            });
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
    if (vadRecordingActiveRef.current) {
      return Promise.resolve();
    }

    if (vadRecordingStartInFlightRef.current) {
      return vadRecordingStartInFlightRef.current;
    }

    const promise = recording
      .start((db, pcm16) => feedVadMeteringFrame(db, pcm16))
      .then(() => {
        vadRecordingActiveRef.current = true;
      })
      .finally(() => {
        vadRecordingStartInFlightRef.current = null;
      });
    vadRecordingStartInFlightRef.current = promise;
    return promise;
  }

  const stopVadRecordingInFlight = useRef<Promise<{
    wavBytes: Uint8Array | null;
  }> | null>(null);

  function stopVadRecording() {
    if (!vadRecordingActiveRef.current) {
      return Promise.resolve({ wavBytes: null });
    }

    if (stopVadRecordingInFlight.current) {
      return stopVadRecordingInFlight.current;
    }

    vadRecordingActiveRef.current = false;
    const promise = recording
      .stop()
      .catch(() => ({ wavBytes: null }) as { wavBytes: Uint8Array | null })
      .finally(() => {
        stopVadRecordingInFlight.current = null;
      });
    stopVadRecordingInFlight.current = promise;
    return promise;
  }

  function suspendVadRecording() {
    stopVadSession();
    clearMicrophoneFrameWatchdog();
    update((s) => ({ ...s, isRecording: false }));
    return stopVadRecording();
  }

  function clearResumeListeningTimer() {
    if (resumeListeningTimerRef.current) {
      clearTimeout(resumeListeningTimerRef.current);
      resumeListeningTimerRef.current = null;
    }
  }

  function scheduleResumeListening(delayMs: number, sequence?: number) {
    if (htmlPlaybackActiveRef.current) {
      return;
    }

    clearResumeListeningTimer();
    resumeListeningTimerRef.current = setTimeout(() => {
      if (
        typeof sequence === "number" &&
        sequence !== playbackSequenceRef.current
      ) {
        return;
      }

      resumeListeningTimerRef.current = null;
      update((s) => ({
        ...s,
        isPlaying: false,
        connectionStatus: "connected",
      }));
      if (stateRef.current.isListening) {
        startVadSession();
        void startVadRecording().catch((error: unknown) => {
          const msg = toErrorMessage(error);
          update((s) => ({
            ...s,
            connectionStatus: "error",
            error: msg,
            isListening: false,
          }));
        });
      }
    }, delayMs);
  }

  useEffect(() => clearResumeListeningTimer, []);
  useEffect(
    () => () => {
      clearMicrophoneFrameWatchdog();
    },
    [],
  );

  function getPlaybackMinBufferMs(configuredMs: number | undefined): number {
    return configuredMs !== undefined && configuredMs >= 0
      ? configuredMs
      : CLIENT_PLAYBACK_MIN_BUFFER_MS;
  }

  function getPlaybackEndGraceMs(configuredMs: number | undefined): number {
    return configuredMs && configuredMs > 0
      ? configuredMs
      : DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS;
  }

  function getAudioChunkDurationMs(
    bytes: Uint8Array,
    sampleRate: number | undefined,
  ): number | null {
    if (!isLocalPcmFrame(bytes)) {
      return null;
    }

    const effectiveSampleRate =
      sampleRate && sampleRate > 0 ? sampleRate : 24000;
    return (getLocalPcmSampleCount(bytes) / effectiveSampleRate) * 1000;
  }

  function scheduleResumeAfterAudioChunk(bytes: Uint8Array): void {
    const playbackSequence = playbackSequenceRef.current + 1;
    playbackSequenceRef.current = playbackSequence;

    const now = Date.now();
    const sampleRate = stateRef.current.voiceConfig?.sample_rate;
    const chunkDurationMs = getAudioChunkDurationMs(bytes, sampleRate);

    if (chunkDurationMs === null) {
      playbackQueueEndAtRef.current =
        now + NON_STREAMING_AUDIO_IDLE_FALLBACK_MS;
      scheduleResumeListening(
        NON_STREAMING_AUDIO_IDLE_FALLBACK_MS,
        playbackSequence,
      );
      return;
    }

    const minBufferMs = getPlaybackMinBufferMs(
      stateRef.current.voiceConfig?.playback_min_buffer_ms,
    );
    const graceMs = getPlaybackEndGraceMs(
      stateRef.current.voiceConfig?.playback_empty_grace_ms,
    );
    const queueStartAt =
      playbackQueueEndAtRef.current > now
        ? playbackQueueEndAtRef.current
        : now + minBufferMs;

    playbackQueueEndAtRef.current = queueStartAt + chunkDurationMs;
    scheduleResumeListening(
      Math.max(0, playbackQueueEndAtRef.current - now + graceMs),
      playbackSequence,
    );
  }

  function handleMessage(message: VoiceSocketMessage) {
    if (message.type === "audio") {
      publishVoiceDiagnostic({
        type: "receive_audio",
        bytes: message.bytes.byteLength,
      });
      if (vadRestartingRef.current) return;
      clearResumeListeningTimer();
      if (!stateRef.current.isPlaying) {
        playbackInputReadyRef.current = suspendVadRecording();
        update((s) => ({ ...s, isPlaying: true }));
      }
      scheduleResumeAfterAudioChunk(message.bytes);
      void playback
        .play(
          message.bytes,
          {
            sampleRate: stateRef.current.voiceConfig?.sample_rate,
            playbackMinBufferMs: getPlaybackMinBufferMs(
              stateRef.current.voiceConfig?.playback_min_buffer_ms,
            ),
            onDebug: handlePlaybackDebug,
          },
          playbackInputReadyRef.current,
        )
        .then(() => {
          publishVoiceDiagnostic({ type: "playback_start" });
        })
        .catch((error: unknown) => {
          const msg = toErrorMessage(error);
          publishVoiceDiagnostic({ type: "playback_error" });
          update((s) => ({
            ...s,
            connectionStatus: "error",
            error: msg,
            isPlaying: false,
          }));
          if (stateRef.current.isListening) {
            startVadSession();
            void startVadRecording().catch((e: unknown) => {
              update((s) => ({
                ...s,
                connectionStatus: "error",
                error: toErrorMessage(e),
                isListening: false,
              }));
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
      appendPendingUserTranscript();
      appendTranscript(createTranscriptEntry("system", "processing"));
      update((s) => ({ ...s, connectionStatus: "processing" }));
      return;
    }

    if (message.type === "transcription") {
      replacePendingUserTranscript(message.text);
      return;
    }

    if (message.type === "response") {
      upsertAssistantTranscript(message.text);
      update((s) => ({
        ...s,
        connectionStatus: "connected",
        retryNotice: message.fallback_reason ? "reconnected" : s.retryNotice,
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
      clearMicrophoneFrameWatchdog();
      playback.stop();
      update((s) => ({
        ...s,
        connectionStatus: "connected",
        isPlaying: false,
      }));
      stopVadSession();
      if (stateRef.current.isListening) {
        vadRestartingRef.current = true;
        void stopVadRecording().then(() =>
          startVadRecording()
            .then(() => {
              vadRestartingRef.current = false;
              startVadSession();
            })
            .catch((e: unknown) => {
              vadRestartingRef.current = false;
              update((s) => ({
                ...s,
                connectionStatus: "error",
                error: toErrorMessage(e),
                isListening: false,
              }));
            }),
        );
      }
    }
  }

  function handleStatusChange(
    status: "idle" | "connecting" | "connected" | "reconnecting" | "error",
    error?: string,
  ) {
    const shouldStopLocalVoice = status === "error";
    if (shouldStopLocalVoice) {
      htmlPlaybackActiveRef.current = false;
      voiceActivityGenerationRef.current += 1;
      clearResumeListeningTimer();
      clearMicrophoneFrameWatchdog();
      stopVadSession();
      void stopVadRecording();
      playback.stop();
      if (teacherMode.isActive) {
        teacherMode.stopLesson?.();
      }
    }

    update((s) => ({
      ...s,
      connectionStatus: status,
      error: error ?? (status === "error" ? s.error : null),
      ...(shouldStopLocalVoice
        ? { isRecording: false, isListening: false, isPlaying: false }
        : null),
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
        publishVoiceDiagnostic({
          type: "send_audio",
          bytes: result.wavBytes.byteLength,
        });
      }
    } catch {}
  }

  async function startListening() {
    if (stateRef.current.isListening || vadRecordingActiveRef.current) {
      return;
    }

    if (listeningStartInFlightRef.current) {
      return listeningStartInFlightRef.current;
    }

    const promise = (async () => {
      voiceActivityGenerationRef.current += 1;
      resetVoiceDiagnostics({ type: "start_listening" });
      if (Platform.OS === "web") {
        playback.prepare();
      }
      const shouldPrimeBrowserRecorder =
        Platform.OS === "web" && !socket.isConnected();
      let browserRecorderPrimed = false;

      if (shouldPrimeBrowserRecorder) {
        try {
          microphoneFrameCountRef.current = 0;
          await startVadRecording();
          browserRecorderPrimed = true;
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
      }

      if (!socket.isConnected()) {
        await socket.connect();
        if (!socket.isConnected()) {
          if (browserRecorderPrimed) {
            await stopVadRecording();
          }
          return;
        }
      }

      if (!browserRecorderPrimed) {
        try {
          microphoneFrameCountRef.current = 0;
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
      }

      update((s) => ({ ...s, isListening: true }));
      if (Platform.OS === "web" && microphoneFrameCountRef.current === 0) {
        scheduleMicrophoneFrameWatchdog();
      }
      startVadSession();
    })().finally(() => {
      listeningStartInFlightRef.current = null;
    });
    listeningStartInFlightRef.current = promise;
    return promise;
  }

  function stopListening() {
    htmlPlaybackActiveRef.current = false;
    voiceActivityGenerationRef.current += 1;
    clearResumeListeningTimer();
    clearMicrophoneFrameWatchdog();
    stopVadSession();
    void stopVadRecording();
    publishVoiceDiagnostic({ type: "stop_listening" });
    update((s) => ({ ...s, isListening: false, isRecording: false }));
  }

  async function interrupt() {
    htmlPlaybackActiveRef.current = false;
    voiceActivityGenerationRef.current += 1;
    clearResumeListeningTimer();
    clearMicrophoneFrameWatchdog();
    playback.stop();
    try {
      socket.sendInterrupt();
    } catch (error) {
      const msg = toErrorMessage(error);
      stopVadSession();
      void stopVadRecording();
      update((s) => ({
        ...s,
        connectionStatus: "error",
        error: msg,
        isPlaying: false,
        isListening: false,
        isRecording: false,
        retryNotice: null,
      }));
      return;
    }

    update((s) => ({ ...s, isPlaying: false, retryNotice: null }));
    stopVadSession();
    if (stateRef.current.isListening) {
      startVadSession();
      void stopVadRecording().then(() =>
        startVadRecording().catch((e: unknown) => {
          update((s) => ({
            ...s,
            connectionStatus: "error",
            error: toErrorMessage(e),
            isListening: false,
          }));
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

  function disconnect() {
    htmlPlaybackActiveRef.current = false;
    voiceActivityGenerationRef.current += 1;
    clearResumeListeningTimer();
    clearMicrophoneFrameWatchdog();
    stopVadSession();
    void stopVadRecording();
    playback.stop();
    socket.disconnect();
    update((s) => ({
      ...s,
      connectionStatus: "idle",
      retryNotice: null,
      error: null,
      isRecording: false,
      isListening: false,
      isPlaying: false,
    }));
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
    disconnect,
  };
}
