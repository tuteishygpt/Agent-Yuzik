import type {
  TeacherStartLessonPayload,
  TeacherStopLessonPayload,
} from "@/features/teacher/teacher-types";

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
  sendAudio: (input: Uint8Array | { wavBytes: Uint8Array; timestamp?: number }) => void;
  sendInterrupt: () => void;
  sendTeacherStartLesson: (payload: TeacherStartLessonPayload) => void;
  sendTeacherStopLesson: (payload: TeacherStopLessonPayload) => void;
  onMessage: (listener: VoiceSocketListener) => () => void;
};

type VoiceSocketOptions = {
  url: string;
  getAccessToken: () => Promise<string | null>;
  WebSocketImpl?: typeof WebSocket;
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

export function buildVoiceAudioFrame(input: {
  wavBytes: Uint8Array;
  timestamp?: number;
}): Uint8Array {
  const timestamp = input.timestamp ?? Date.now();
  const payload = cloneBytes(input.wavBytes);
  const frame = new Uint8Array(payload.length + END_MARKER.length + TIMESTAMP_SIZE);

  frame.set(payload, 0);
  frame.set(END_MARKER, payload.length);

  const view = new DataView(frame.buffer);
  view.setUint32(frame.length - TIMESTAMP_SIZE, timestamp >>> 0, true);

  return frame;
}

export function parseVoiceSocketMessage(raw: string): VoiceControlMessage | null {
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
  WebSocketImpl = WebSocket,
}: VoiceSocketOptions): VoiceSocketClient {
  let socket: WebSocket | null = null;
  let authenticated = false;
  let authToken: string | null = null;
  const listeners = new Set<VoiceSocketListener>();

  function emit(message: VoiceSocketMessage) {
    for (const listener of listeners) {
      listener(message);
    }
  }

  function ensureSocket(): WebSocket {
    if (!socket) {
      throw new Error("Voice socket is not connected.");
    }

    return socket;
  }

  async function connect(): Promise<void> {
    authToken = await getAccessToken();

    if (!authToken) {
      throw new Error("Missing Supabase access token.");
    }

    socket = new WebSocketImpl(url);
    socket.binaryType = "arraybuffer";
    authenticated = false;

    socket.onopen = () => {
      if (!socket || authenticated) {
        return;
      }

      sendJson(socket, {
        type: "auth",
        access_token: authToken,
      });
      authenticated = true;
    };

    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      const data = event.data;

      if (typeof data === "string") {
        const message = parseVoiceSocketMessage(data);
        if (message) {
          emit(message);
        }
        return;
      }

      emit({
        type: "audio",
        bytes: toUint8Array(data),
      });
    };

    socket.onclose = () => {
      authenticated = false;
    };
  }

  function disconnect(): void {
    socket?.close();
    socket = null;
    authenticated = false;
  }

  function sendAudio(input: Uint8Array | { wavBytes: Uint8Array; timestamp?: number }): void {
    const nextSocket = ensureSocket();

    if (!authenticated) {
      throw new Error("Voice auth must be sent before audio.");
    }

    nextSocket.send(input instanceof Uint8Array ? input : buildVoiceAudioFrame(input));
  }

  function sendInterrupt(): void {
    sendJson(ensureSocket(), { type: "interrupt" });
  }

  function sendTeacherStartLesson(payload: TeacherStartLessonPayload): void {
    sendJson(ensureSocket(), {
      type: "teacher_start_lesson",
      ...payload,
    });
  }

  function sendTeacherStopLesson(payload: TeacherStopLessonPayload): void {
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
