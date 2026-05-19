import { useEffect, useRef } from "react";

import type {
  TeacherStartLessonPayload,
  TeacherStopLessonPayload,
} from "@/features/teacher/teacher-types";
import {
  createVoiceSocketClient,
  type VoiceSocketClient,
  type VoiceSocketMessage,
} from "@/lib/voice-socket";
import { VoiceError, toErrorMessage } from "@/lib/errors";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";

import type { VoiceSessionOptions } from "./useVoiceSession";

function buildVoiceSocketUrl(backendUrl: string): string {
  const normalized = backendUrl.replace(/\/+$/, "");
  return normalized.replace(/^http/i, "ws") + "/api/voice";
}

export type VoiceSocketControls = {
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  sendAudio: (data: Uint8Array | { wavBytes: Uint8Array; timestamp?: number }) => void;
  sendInterrupt: () => void;
  sendTeacherStartLesson: (payload: TeacherStartLessonPayload) => void;
  sendTeacherStopLesson: (payload: TeacherStopLessonPayload) => void;
  isConnected: () => boolean;
};

export function useVoiceSocket(
  options: VoiceSessionOptions,
  onMessage: (msg: VoiceSocketMessage) => void,
  onStatusChange: (
    status: "idle" | "connecting" | "connected" | "reconnecting" | "error",
    error?: string,
  ) => void,
): VoiceSocketControls {
  const socketRef = useRef<VoiceSocketClient | null>(null);
  const unsubMessageRef = useRef<(() => void) | null>(null);
  const connectingRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    return () => {
      unsubMessageRef.current?.();
      socketRef.current?.disconnect();
    };
  }, []);

  async function establishSocket(isReconnect: boolean) {
    if (connectingRef.current) return;
    connectingRef.current = true;

    const backendUrl = options.backendUrl ?? getRuntimeEnv().backendUrl;
    const getAccessToken =
      options.getAccessToken ??
      (async () => (await getSupabaseSession())?.access_token ?? null);
    const socketFactory =
      options.socketClientFactory ??
      ((socketOptions) => createVoiceSocketClient(socketOptions));

    unsubMessageRef.current?.();
    unsubMessageRef.current = null;
    socketRef.current?.disconnect();
    onStatusChangeRef.current(isReconnect ? "reconnecting" : "connecting");

    const wsUrl = buildVoiceSocketUrl(backendUrl);
    const socket = socketFactory({
      url: wsUrl,
      getAccessToken,
      onUnexpectedClose: () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        onStatusChangeRef.current("idle");
      },
    });

    unsubMessageRef.current = socket.onMessage((msg) => onMessageRef.current(msg));
    socketRef.current = socket;

    try {
      await socket.connect();
    } catch (error) {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      onStatusChangeRef.current("error", toErrorMessage(error));
      return;
    } finally {
      connectingRef.current = false;
    }

    onStatusChangeRef.current("connected");
  }

  return {
    connect: () => establishSocket(false),
    reconnect: () => establishSocket(true),
    sendAudio: (input) => {
      if (!socketRef.current)
        throw new VoiceError("SOCKET_NOT_CONNECTED", "Voice socket is not connected.");
      socketRef.current.sendAudio(input);
    },
    sendInterrupt: () => {
      if (!socketRef.current)
        throw new VoiceError("SOCKET_NOT_CONNECTED", "Voice socket is not connected.");
      socketRef.current.sendInterrupt();
    },
    sendTeacherStartLesson: (payload: TeacherStartLessonPayload) => {
      if (!socketRef.current)
        throw new VoiceError("SOCKET_NOT_CONNECTED", "Voice socket is not connected.");
      socketRef.current.sendTeacherStartLesson(payload);
    },
    sendTeacherStopLesson: (payload: TeacherStopLessonPayload) => {
      if (!socketRef.current)
        throw new VoiceError("SOCKET_NOT_CONNECTED", "Voice socket is not connected.");
      socketRef.current.sendTeacherStopLesson(payload);
    },
    isConnected: () => socketRef.current !== null,
  };
}
