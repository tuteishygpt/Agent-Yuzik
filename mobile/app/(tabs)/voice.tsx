import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";

import { VoiceControls } from "@/features/voice/VoiceControls";
import { VoiceScreenFrame } from "@/features/voice/VoiceScreenFrame";
import { VoiceStage } from "@/features/voice/VoiceStage";
import { resolveVoiceUiState } from "@/features/voice/voice-ui-state";
import { useVoiceAnimations } from "@/features/voice/useVoiceAnimations";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { useI18n } from "@/lib/i18n";
import { useMenu } from "@/navigation/MenuContext";
import { useAuth } from "@/providers/AuthProvider";
import { useVoiceSettings } from "@/providers/VoiceSettingsProvider";

export default function VoiceScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const { openMenu } = useMenu();
  const { preferNativeTenVad } = useVoiceSettings();
  const voiceSession = useVoiceSession({
    teacherMode: null,
    sessionKind: "voice",
    vadConfig: {
      preferNativeTenVad,
    },
  });
  const voiceSessionRef = useRef(voiceSession);
  const screenActiveRef = useRef(true);
  const uiState = resolveVoiceUiState({
    status: voiceSession.status,
    isRecording: voiceSession.isRecording,
    isListening: voiceSession.isListening,
    isPlaying: voiceSession.isPlaying,
  });
  const { styles: animatedStyles, visualizerPulse } =
    useVoiceAnimations(uiState);

  const isAuthenticated = auth.status === "ready" && !!auth.session;
  const shouldAutoConnect = isAuthenticated && voiceSession.status === "idle";
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoConnectRef = useRef(shouldAutoConnect);
  shouldAutoConnectRef.current = shouldAutoConnect;

  useEffect(() => {
    voiceSessionRef.current = voiceSession;
  });

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      if (shouldAutoConnectRef.current) {
        retryCountRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        void voiceSessionRef.current.connect();
      }
      return () => {
        screenActiveRef.current = false;
        const session = voiceSessionRef.current;
        session.stopListening();
        void (async () => {
          try {
            if (session.status !== "idle" && session.status !== "error") {
              await session.interrupt();
            }
          } catch (_) {
          } finally {
            session.disconnect();
          }
        })();
      };
    }, []),
  );

  useEffect(() => {
    if (!shouldAutoConnect || !screenActiveRef.current) {
      retryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    const attempt = retryCountRef.current;
    const delayMs = attempt === 0 ? 0 : Math.min(1000 * 2 ** (attempt - 1), 10000);

    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      retryCountRef.current = attempt + 1;
      if (!screenActiveRef.current) {
        return;
      }
      void voiceSessionRef.current.connect();
    }, delayMs);

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [shouldAutoConnect]);

  return (
    <VoiceScreenFrame
      headerTestID="voice-screen-header"
      menuAccessibilityLabel="Open voice menu"
      onOpenMenu={openMenu}
      title={t("voice.title")}
      bottomControls={
        <VoiceControls
          isListening={voiceSession.isListening}
          onInterrupt={voiceSession.interrupt}
          onStartListening={voiceSession.startListening}
          onStopListening={voiceSession.stopListening}
          status={voiceSession.status}
        />
      }
    >
      <VoiceStage
        animatedStyles={animatedStyles}
        compact
        error={voiceSession.error}
        notice={voiceSession.retryNotice}
        onPrimaryPress={() => {
          if (voiceSession.isListening) {
            voiceSession.stopListening();
            void voiceSession.interrupt();
          } else {
            void voiceSession.startListening();
          }
        }}
        showStatusPill={false}
        transcript={voiceSession.transcript}
        uiState={uiState}
        visualizerPulse={visualizerPulse}
      />
    </VoiceScreenFrame>
  );
}
