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
import { Platform } from "react-native";
import { VoiceError, toErrorMessage } from "@/lib/errors";
import { getRuntimeEnv } from "@/lib/env";
import { getOrCreateInstallId } from "@/lib/install-id";
import { getSupabaseSession } from "@/lib/supabase";

import type { VoiceSessionOptions } from "./useVoiceSession";

function buildVoiceSocketUrl(backendUrl: string): string {
  const normalized = backendUrl.replace(/\/+$/, "");
  return normalized.replace(/^http/i, "ws") + "/api/voice";
}

export type VoiceSocketControls = {
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  sendAudio: (
    data: Uint8Array | { wavBytes: Uint8Array; timestamp?: number },
  ) => void;
  sendInterrupt: () => void;
  sendTeacherStartLesson: (payload: TeacherStartLessonPayload) => void;
  sendTeacherStopLesson: (payload: TeacherStopLessonPayload) => void;
  disconnect: () => void;
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
  const connectionGenerationRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    return () => {
      connectionGenerationRef.current += 1;
      unsubMessageRef.current?.();
      socketRef.current?.disconnect();
    };
  }, []);

  async function establishSocket(isReconnect: boolean) {
    if (connectingRef.current) return;
    connectingRef.current = true;
    const connectionGeneration = connectionGenerationRef.current + 1;
    connectionGenerationRef.current = connectionGeneration;

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

    const platformPrefix = Platform.OS === "ios" ? "ios" : "and";
    const sessionKind = options.sessionKind ?? "voice";
    const installId = await getOrCreateInstallId();
    const voiceUserId = `voice-user-${platformPrefix}-${sessionKind}-${installId.slice(0, 5)}`;

    const query = new URLSearchParams({
      user_id: voiceUserId,
      session_kind: sessionKind,
    });
    const wsUrl = `${buildVoiceSocketUrl(backendUrl)}?${query.toString()}`;
    const socket = socketFactory({
      url: wsUrl,
      getAccessToken,
      getInstallId: async () => voiceUserId,
      onUnexpectedClose: (reason?: string) => {
        if (socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;
        onStatusChangeRef.current(
          "error",
          reason ?? "Voice socket disconnected.",
        );
      },
    });

    unsubMessageRef.current = socket.onMessage((msg) =>
      onMessageRef.current(msg),
    );
    socketRef.current = socket;

    try {
      await socket.connect();
    } catch (error) {
      socket.disconnect();
      if (connectionGenerationRef.current === connectionGeneration) {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        onStatusChangeRef.current("error", toErrorMessage(error));
      }
      return;
    } finally {
      if (connectionGenerationRef.current === connectionGeneration) {
        connectingRef.current = false;
      }
    }

    if (
      connectionGenerationRef.current !== connectionGeneration ||
      socketRef.current !== socket
    ) {
      socket.disconnect();
      return;
    }

    onStatusChangeRef.current("connected");
  }

  return {
    connect: () => establishSocket(false),
    reconnect: () => establishSocket(true),
    disconnect: () => {
      connectionGenerationRef.current += 1;
      unsubMessageRef.current?.();
      unsubMessageRef.current = null;
      socketRef.current?.disconnect();
      socketRef.current = null;
      connectingRef.current = false;
      onStatusChangeRef.current("idle");
    },
    sendAudio: (input) => {
      if (!socketRef.current)
        throw new VoiceError(
          "SOCKET_NOT_CONNECTED",
          "Voice socket is not connected.",
        );
      socketRef.current.sendAudio(input);
    },
    sendInterrupt: () => {
      if (!socketRef.current)
        throw new VoiceError(
          "SOCKET_NOT_CONNECTED",
          "Voice socket is not connected.",
        );
      socketRef.current.sendInterrupt();
    },
    sendTeacherStartLesson: (payload: TeacherStartLessonPayload) => {
      if (!socketRef.current)
        throw new VoiceError(
          "SOCKET_NOT_CONNECTED",
          "Voice socket is not connected.",
        );
      socketRef.current.sendTeacherStartLesson(payload);
    },
    sendTeacherStopLesson: (payload: TeacherStopLessonPayload) => {
      if (!socketRef.current)
        throw new VoiceError(
          "SOCKET_NOT_CONNECTED",
          "Voice socket is not connected.",
        );
      socketRef.current.sendTeacherStopLesson(payload);
    },
    isConnected: () => socketRef.current !== null,
  };
}
