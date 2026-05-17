export type VoiceErrorCode =
  | "SOCKET_NOT_CONNECTED"
  | "SOCKET_CONNECT_FAILED"
  | "RECORDING_FAILED"
  | "RECORDING_NOT_STARTED"
  | "PLAYBACK_FAILED"
  | "CACHE_UNAVAILABLE"
  | "TEACHER_LESSON_FAILED";

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(code: VoiceErrorCode, message: string) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof VoiceError) return error.message;
  if (error instanceof Error) return error.message;
  return "Voice mode failed.";
}
