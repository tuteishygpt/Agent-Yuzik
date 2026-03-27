import { useEffect } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import LessonPicker from "@/features/teacher/LessonPicker";
import TeacherBanner from "@/features/teacher/TeacherBanner";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";
import { TranscriptPanel } from "@/features/voice/TranscriptPanel";
import { VoiceControls } from "@/features/voice/VoiceControls";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";

export default function VoiceScreen() {
  const teacherMode = useTeacherMode();
  const voiceSession = useVoiceSession({
    teacherMode,
  });

  useEffect(() => {
    void (async () => {
      const session = await getSupabaseSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        return;
      }

      await teacherMode.loadLessons({
        backendUrl: getRuntimeEnv().backendUrl,
        accessToken,
      });
    })();
  }, [teacherMode]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Voice mode</Text>
          <Text style={styles.title}>Push to talk with reconnect and teacher flow</Text>
          {voiceSession.retryNotice ? (
            <Text style={styles.notice}>{voiceSession.retryNotice}</Text>
          ) : null}
          {voiceSession.error ? <Text style={styles.error}>{voiceSession.error}</Text> : null}
        </View>

        <TeacherBanner
          lesson={teacherMode.selectedLesson}
          stepPrompt={teacherMode.currentPrompt}
          isActive={teacherMode.isActive}
        />

        <LessonPicker
          lessons={teacherMode.lessons}
          selectedLessonId={teacherMode.selectedLesson?.id ?? null}
          onSelectLesson={teacherMode.selectLesson}
        />

        <TranscriptPanel transcript={voiceSession.transcript} />
      </ScrollView>

      <VoiceControls
        status={voiceSession.status}
        isRecording={voiceSession.isRecording}
        isTeacherActive={teacherMode.isActive}
        onConnect={voiceSession.connect}
        onReconnect={voiceSession.reconnect}
        onStartRecording={voiceSession.startRecording}
        onStopRecording={voiceSession.stopRecording}
        onInterrupt={voiceSession.interrupt}
        onStartTeacherLesson={voiceSession.startTeacherLesson}
        onStopTeacherLesson={voiceSession.stopTeacherLesson}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f9fc",
  },
  content: {
    gap: 18,
    paddingBottom: 20,
  },
  hero: {
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  kicker: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#101828",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
  },
  notice: {
    color: "#a15c07",
    fontSize: 14,
  },
  error: {
    color: "#b42318",
    fontSize: 14,
  },
});
