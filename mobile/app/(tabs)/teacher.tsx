import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import LessonPicker from "@/features/teacher/LessonPicker";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";
import { VoiceControls } from "@/features/voice/VoiceControls";
import { VoiceScreenFrame } from "@/features/voice/VoiceScreenFrame";
import { VoiceStage } from "@/features/voice/VoiceStage";
import { resolveVoiceUiState } from "@/features/voice/voice-ui-state";
import { useVoiceAnimations } from "@/features/voice/useVoiceAnimations";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { getRuntimeEnv } from "@/lib/env";
import { useI18n } from "@/lib/i18n";
import { getSupabaseSession } from "@/lib/supabase";
import { useMenu } from "@/navigation/MenuContext";
import { useAuth } from "@/providers/AuthProvider";
import { useVoiceSettings } from "@/providers/VoiceSettingsProvider";

export default function TeacherScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const { openMenu } = useMenu();
  const env = getRuntimeEnv();
  const teacherMode = useTeacherMode();
  const { preferNativeTenVad } = useVoiceSettings();
  const voiceSession = useVoiceSession({
    teacherMode,
    sessionKind: "teacher",
    vadConfig: {
      preferNativeTenVad,
    },
  });
  const startedLessonRef = useRef<string | null>(null);
  const manualStopRef = useRef(false);
  const teacherModeRef = useRef(teacherMode);
  const voiceSessionRef = useRef(voiceSession);
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const uiState = resolveVoiceUiState({
    status: voiceSession.status,
    isRecording: voiceSession.isRecording,
    isListening: voiceSession.isListening,
    isPlaying: voiceSession.isPlaying,
  });
  const { styles: animatedStyles, visualizerPulse } =
    useVoiceAnimations(uiState);

  useEffect(() => {
    teacherModeRef.current = teacherMode;
    voiceSessionRef.current = voiceSession;
  });

  const stopTeacherSession = useCallback(() => {
    manualStopRef.current = true;
    const session = voiceSessionRef.current;
    const teacher = teacherModeRef.current;

    session.stopListening();
    void (async () => {
      if (session.teacherSelection.active || teacher.isActive) {
        await session.stopTeacherLesson();
      }

      try {
        await session.interrupt();
      } catch (_) {}

      session.disconnect();
      startedLessonRef.current = null;
    })();
  }, []);

  const startTeacherSession = useCallback(() => {
    const teacher = teacherModeRef.current;
    const selectedLessonId = teacher.selectedLesson?.id ?? null;
    const hasSelectedLesson = selectedLessonId != null;

    if (!hasSelectedLesson) {
      setStartNotice("Абярыце занятак са спісу.");
    } else {
      setStartNotice(null);
    }

    manualStopRef.current = false;
    const session = voiceSessionRef.current;

    void (async () => {
      if (session.status === "idle" || session.status === "error") {
        await session.connect();
      }

      await voiceSessionRef.current.startListening();

      const latestSession = voiceSessionRef.current;
      const latestTeacher = teacherModeRef.current;
      if (
        selectedLessonId &&
        !latestTeacher.isActive &&
        !latestSession.teacherSelection.active
      ) {
        startedLessonRef.current = selectedLessonId;
        await latestSession.startTeacherLesson();
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        const session = voiceSessionRef.current;
        const teacher = teacherModeRef.current;

        if (
          session.teacherSelection.active ||
          teacher.isActive ||
          session.isListening ||
          session.status === "connected" ||
          session.status === "processing"
        ) {
          stopTeacherSession();
        }
      };
    }, [stopTeacherSession]),
  );

  const isAuthenticated = auth.status === "ready" && !!auth.session;
  const shouldAutoConnect =
    isAuthenticated &&
    !manualStopRef.current &&
    (voiceSession.status === "idle" || voiceSession.status === "error");
  const selectionNotice =
    startNotice ??
    (!teacherMode.selectedLesson && teacherMode.lessons.length > 0
      ? "Абярыце занятак са спісу."
      : null);

  const notice =
    [voiceSession.retryNotice ?? selectionNotice, voiceSession.diagnostics]
      .filter((value): value is string => Boolean(value))
      .join("\n") || null;

  useEffect(() => {
    void (async () => {
      try {
        const session = await getSupabaseSession();
        const accessToken = session?.access_token;
        if (!accessToken) return;
        await teacherMode.loadLessons({
          backendUrl: env.backendUrl,
          accessToken,
        });
      } catch (_) {}
    })();
  }, [env.backendUrl]);

  useEffect(() => {
    if (shouldAutoConnect) {
      void voiceSession.connect();
    }
  }, [shouldAutoConnect, voiceSession.status]);

  useEffect(() => {
    if (teacherMode.selectedLesson) {
      setStartNotice(null);
    }
  }, [teacherMode.selectedLesson?.id]);

  useEffect(() => {
    if (voiceSession.status === "error") {
      startedLessonRef.current = null;
    }
  }, [voiceSession.status]);

  return (
    <VoiceScreenFrame
      menuAccessibilityLabel="Open teacher menu"
      onOpenMenu={openMenu}
      title={t("voice.teacher")}
      bottomControls={
        <VoiceControls
          inputLevel={voiceSession.inputLevel}
          isListening={voiceSession.isListening}
          onInterrupt={() => undefined}
          onStartListening={startTeacherSession}
          onStopListening={stopTeacherSession}
          status={voiceSession.status}
          uiState={uiState}
          visualizerPulse={visualizerPulse}
        />
      }
    >
      <VoiceStage
        animatedStyles={animatedStyles}
        childrenBeforeStage={
          <LessonPicker
            isActive={teacherMode.isActive}
            lessons={teacherMode.lessons}
            onSelectLesson={(lessonId) => {
              manualStopRef.current = false;
              setStartNotice(null);
              startedLessonRef.current = null;
              teacherMode.selectLesson(lessonId);
            }}
            selectedLessonId={teacherMode.selectedLesson?.id ?? null}
            stepPrompt={teacherMode.currentPrompt}
          />
        }
        compact
        error={voiceSession.error}
        eyebrow="Юзік"
        notice={notice}
        onPrimaryPress={() => {
          if (voiceSession.isListening) {
            stopTeacherSession();
          } else {
            startTeacherSession();
          }
        }}
        title={t("voice.teacher")}
        transcript={voiceSession.transcript}
        uiState={uiState}
      />
    </VoiceScreenFrame>
  );
}
