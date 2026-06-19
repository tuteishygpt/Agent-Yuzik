import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { MobileScreenShell } from "@/components/mobile";
import LessonPicker from "@/features/teacher/LessonPicker";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";
import { VoiceControls } from "@/features/voice/VoiceControls";
import { VoiceStage } from "@/features/voice/VoiceStage";
import { resolveVoiceUiState } from "@/features/voice/voice-ui-state";
import { useVoiceAnimations } from "@/features/voice/useVoiceAnimations";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";
import { useMenu } from "@/navigation/MenuContext";
import { useAuth } from "@/providers/AuthProvider";

export default function TeacherScreen() {
  const auth = useAuth();
  const { openMenu } = useMenu();
  const env = getRuntimeEnv();
  const teacherMode = useTeacherMode();
  const voiceSession = useVoiceSession({ teacherMode, sessionKind: "teacher" });
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
      setStartNotice("Choose a lesson from the list.");
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
  const isReconnecting =
    voiceSession.status === "connecting" ||
    voiceSession.status === "reconnecting";
  const isDisconnected =
    voiceSession.status === "idle" || voiceSession.status === "error";
  const connectionLabel = isReconnecting
    ? "Reconnecting"
    : isDisconnected
      ? "Disconnected"
      : "Lesson ready";
  const selectionNotice =
    startNotice ??
    (!teacherMode.selectedLesson && teacherMode.lessons.length > 0
      ? "Choose a lesson from the list."
      : null);

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
    <MobileScreenShell contentStyle={styles.shellContent}>
      <ScrollView contentContainerStyle={styles.content}>
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
          connectionLabel={connectionLabel}
          error={voiceSession.error}
          eyebrow="Yuzik"
          notice={voiceSession.retryNotice ?? selectionNotice}
          onPrimaryPress={() => {
            if (voiceSession.isListening) {
              stopTeacherSession();
            } else {
              startTeacherSession();
            }
          }}
          title="Teacher"
          transcript={voiceSession.transcript}
          uiState={uiState}
          visualizerPulse={visualizerPulse}
        />
      </ScrollView>

      <VoiceControls
        isListening={voiceSession.isListening}
        onInterrupt={() => undefined}
        onOpenMenu={openMenu}
        onStartListening={startTeacherSession}
        onStopListening={stopTeacherSession}
        status={voiceSession.status}
      />
    </MobileScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  content: {
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 14,
    paddingBottom: 28,
    paddingTop: 10,
  },
});
