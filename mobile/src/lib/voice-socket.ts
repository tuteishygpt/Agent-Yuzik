import { AppState, type AppStateStatus } from "react-native";

import type {
  TeacherStartLessonPayload,
  TeacherStopLessonPayload,
} from "@/features/teacher/teacher-types";
import { getRuntimeEnv } from "@/lib/env";

export type VoiceConfigMessage = {
  type: "voice_config";
  tts_mode?: string;
  sample_rate?: number;
  script_buffer_size?: number;
  playback_min_buffer_ms?: number;
  playback_empty_grace_ms?: number;
};

export type VoiceProcessingMessage = {
  type: "processing";
};

export type VoiceTranscriptionMessage = {
  type: "transcription";
  text: string;
};

export type VoiceResponseMessage = {
  type: "response";
  text: string;
  mode?: string;
  teacher_action?: string;
  step_id?: string;
  fallback_reason?: string;
};

export type VoiceTeacherStartedMessage = {
  type: "teacher_mode_started";
  lesson_id: string;
  step_id: string;
  prompt: string;
  mode?: string;
};

export type VoiceTeacherStoppedMessage = {
  type: "teacher_mode_stopped";
  mode?: string;
};

export type VoiceErrorMessage = {
  type: "error";
  message: string;
};

export type VoiceInterruptionHandshakeMessage = {
  type: "interruption_handshake";
};

export type VoiceControlMessage =
  | VoiceConfigMessage
  | VoiceProcessingMessage
  | VoiceTranscriptionMessage
  | VoiceResponseMessage
  | VoiceTeacherStartedMessage
  | VoiceTeacherStoppedMessage
  | VoiceErrorMessage
  | VoiceInterruptionHandshakeMessage;

export type VoiceAudioMessage = {
  type: "audio";
  bytes: Uint8Array;
};

export type VoiceSocketMessage = VoiceControlMessage | VoiceAudioMessage;

export type VoiceSocketListener = (message: VoiceSocketMessage) => void;

export type VoiceSocketClient = {
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudio: (
    input: Uint8Array | { wavBytes: Uint8Array; timestamp?: number },
  ) => void;
  sendInterrupt: () => void;
  sendTeacherStartLesson: (payload: TeacherStartLessonPayload) => void;
  sendTeacherStopLesson: (payload: TeacherStopLessonPayload) => void;
  onMessage: (listener: VoiceSocketListener) => () => void;
};

type VoiceSocketOptions = {
  url: string;
  getAccessToken: () => Promise<string | null>;
  getInstallId?: () => Promise<string | null>;
  WebSocketImpl?: typeof WebSocket;
  onUnexpectedClose?: (reason?: string) => void;
};

const END_MARKER = new Uint8Array([0x45, 0x4e, 0x44, 0x00]);
const TIMESTAMP_SIZE = 4;

function toUint8Array(value: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }

  return new Uint8Array(value);
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function encodeMessage(value: unknown): string {
  return JSON.stringify(value);
}

function sendJson(socket: Pick<WebSocket, "send">, payload: unknown): void {
  socket.send(encodeMessage(payload));
}

function isNetworkLoggingEnabled(): boolean {
  try {
    return getRuntimeEnv().debugNetworkLoggingEnabled;
  } catch {
    return false;
  }
}

function logVoiceSocket(
  message: string,
  metadata?: Record<string, unknown>,
): void {
  if (!isNetworkLoggingEnabled()) {
    return;
  }

  if (metadata) {
    console.log(`[VoiceSocket] ${message}`, metadata);
    return;
  }

  console.log(`[VoiceSocket] ${message}`);
}

function getWebSocketErrorMessage(event: unknown): string {
  if (event && typeof event === "object" && "message" in event) {
    const message = (event as { message?: unknown }).message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Voice socket connection failed.";
}

export function buildVoiceAudioFrame(input: {
  wavBytes: Uint8Array;
  timestamp?: number;
}): Uint8Array {
  const timestamp = input.timestamp ?? Date.now();
  const payload = cloneBytes(input.wavBytes);
  const frame = new Uint8Array(
    payload.length + END_MARKER.length + TIMESTAMP_SIZE,
  );

  frame.set(payload, 0);
  frame.set(END_MARKER, payload.length);

  const view = new DataView(frame.buffer);
  view.setUint32(frame.length - TIMESTAMP_SIZE, timestamp >>> 0, true);

  return frame;
}

export function parseVoiceSocketMessage(
  raw: string,
): VoiceControlMessage | null {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;

    if (payload && typeof payload.type === "string") {
      return payload as VoiceControlMessage;
    }
  } catch {
    return null;
  }

  return null;
}

export function createVoiceSocketClient({
  url,
  getAccessToken,
  getInstallId,
  WebSocketImpl = WebSocket,
  onUnexpectedClose,
}: VoiceSocketOptions): VoiceSocketClient {
  let socket: WebSocket | null = null;
  let authenticated = false;
  let authToken: string | null = null;
  let installId: string | null = null;
  const listeners = new Set<VoiceSocketListener>();

  function emit(message: VoiceSocketMessage) {
    for (const listener of listeners) {
      try {
        listener(message);
      } catch (e) {
        console.error("[VoiceSocket] listener error", e);
      }
    }
  }

  function ensureSocket(): WebSocket {
    if (!socket) {
      throw new Error("Voice socket is not connected.");
    }

    return socket;
  }

  const CONNECT_TIMEOUT_MS = 15000;

  async function connect(): Promise<void> {
    authToken = await getAccessToken();
    installId = (await getInstallId?.()) ?? null;

    if (!authToken) {
      throw new Error("Missing Supabase access token.");
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const startedAt = Date.now();

      const connectTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket?.close();
          socket = null;
          reject(new Error("Voice socket connection timed out."));
        }
      }, CONNECT_TIMEOUT_MS);

      logVoiceSocket("connect", {
        url,
        hasAuthToken: true,
      });

      socket = new WebSocketImpl(url);
      socket.binaryType = "arraybuffer";
      authenticated = false;

      const settleConnect = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(connectTimer);
        callback();
      };

      socket.onopen = () => {
        if (!socket || authenticated) {
          return;
        }

        logVoiceSocket("open", {
          url,
          durationMs: Date.now() - startedAt,
        });

        sendJson(socket, {
          type: "auth",
          access_token: authToken,
          ...(installId ? { install_id: installId } : {}),
        });
        try {
          const claims = JSON.parse(atob(authToken!.split(".")[1]));
          logVoiceSocket("sent auth", { url, sub: claims.sub, installId });
        } catch {
          logVoiceSocket("sent auth", { url });
        }
        authenticated = true;
        subscribeAppState();
        settleConnect(resolve);
      };

      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        const data = event.data;

        if (typeof data === "string") {
          const message = parseVoiceSocketMessage(data);
          if (message) {
            logVoiceSocket("received control", {
              type: message.type,
              bytes: data.length,
            });
            emit(message);
          }
          return;
        }

        logVoiceSocket("received audio", {
          bytes: data.byteLength,
        });
        emit({
          type: "audio",
          bytes: toUint8Array(data),
        });
      };

      socket.onerror = (event: Event) => {
        const message = getWebSocketErrorMessage(event);
        logVoiceSocket("error", { url, message });
        const wasAuthenticated = authenticated;
        const deadSocket = socket;
        socket = null;
        authenticated = false;
        unsubscribeAppState();
        if (settled && wasAuthenticated) {
          onUnexpectedClose?.(message);
        } else {
          settleConnect(() => reject(new Error(message)));
        }
        try {
          deadSocket?.close();
        } catch {}
      };

      socket.onclose = (event?: CloseEvent) => {
        logVoiceSocket("close", {
          url,
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
        });
        const wasAuthenticated = authenticated;
        authenticated = false;
        socket = null;
        unsubscribeAppState();
        if (settled && wasAuthenticated) {
          onUnexpectedClose?.(
            event?.reason || "Voice socket closed unexpectedly.",
          );
        } else {
          settleConnect(() =>
            reject(new Error("Voice socket closed before opening.")),
          );
        }
      };
    });
  }

  let appStateSubscription: ReturnType<
    typeof AppState.addEventListener
  > | null = null;
  let backgroundDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const BACKGROUND_DISCONNECT_DELAY_MS = 3000;

  function handleAppStateChange(state: AppStateStatus): void {
    if (state === "background") {
      if (socket && !backgroundDisconnectTimer) {
        backgroundDisconnectTimer = setTimeout(() => {
          backgroundDisconnectTimer = null;
          if (socket) {
            logVoiceSocket("backgrounded, disconnecting");
            disconnect();
          }
        }, BACKGROUND_DISCONNECT_DELAY_MS);
      }
    } else if (state === "active") {
      if (backgroundDisconnectTimer) {
        clearTimeout(backgroundDisconnectTimer);
        backgroundDisconnectTimer = null;
        logVoiceSocket("returned from background, keeping connection");
      }
    }
  }

  function subscribeAppState(): void {
    if (!appStateSubscription) {
      appStateSubscription = AppState.addEventListener(
        "change",
        handleAppStateChange,
      );
    }
  }

  function unsubscribeAppState(): void {
    appStateSubscription?.remove();
    appStateSubscription = null;
  }

  function disconnect(): void {
    logVoiceSocket("disconnect");
    if (backgroundDisconnectTimer) {
      clearTimeout(backgroundDisconnectTimer);
      backgroundDisconnectTimer = null;
    }
    unsubscribeAppState();
    socket?.close();
    socket = null;
    authenticated = false;
  }

  function sendAudio(
    input: Uint8Array | { wavBytes: Uint8Array; timestamp?: number },
  ): void {
    const nextSocket = ensureSocket();

    if (!authenticated) {
      throw new Error("Voice auth must be sent before audio.");
    }

    const frame =
      input instanceof Uint8Array ? input : buildVoiceAudioFrame(input);
    logVoiceSocket("sent audio", { bytes: frame.byteLength });
    nextSocket.send(frame);
  }

  function sendInterrupt(): void {
    logVoiceSocket("sent interrupt");
    sendJson(ensureSocket(), { type: "interrupt" });
  }

  function sendTeacherStartLesson(payload: TeacherStartLessonPayload): void {
    logVoiceSocket("sent teacher_start_lesson", {
      lessonId: payload.lesson_id,
      stepId: payload.step_id,
    });
    sendJson(ensureSocket(), {
      type: "teacher_start_lesson",
      ...payload,
    });
  }

  function sendTeacherStopLesson(payload: TeacherStopLessonPayload): void {
    logVoiceSocket("sent teacher_stop_lesson", {
      lessonId: payload.lesson_id,
      sessionId: payload.session_id,
    });
    sendJson(ensureSocket(), {
      type: "teacher_stop_lesson",
      ...payload,
    });
  }

  function onMessage(listener: VoiceSocketListener): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  return {
    connect,
    disconnect,
    sendAudio,
    sendInterrupt,
    sendTeacherStartLesson,
    sendTeacherStopLesson,
    onMessage,
  };
}
