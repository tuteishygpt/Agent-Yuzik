import { useEffect } from "react";
import {
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import LessonPicker from "@/features/teacher/LessonPicker";
import TeacherBanner from "@/features/teacher/TeacherBanner";
import { useTeacherMode } from "@/features/teacher/useTeacherMode";
import { TranscriptPanel } from "@/features/voice/TranscriptPanel";
import { VoiceControls } from "@/features/voice/VoiceControls";
import { resolveVoiceUiState } from "@/features/voice/voice-ui-state";
import { useVoiceAnimations } from "@/features/voice/useVoiceAnimations";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";
import { webGlassPanel, webTextStyles, webTheme } from "@/theme/webTheme";

const VISUALIZER_BAR_COUNT = 24;
const visualizerHeights = Array.from(
  { length: VISUALIZER_BAR_COUNT },
  (_, i) => 12 + ((i * 11) % 52),
);

function VisualizerBars({
  pulse,
  uiState,
}: {
  pulse: Animated.Value;
  uiState: ReturnType<typeof resolveVoiceUiState>;
}) {
  return (
    <View
      style={[
        styles.visualizer,
        uiState.phase === "processing" ? styles.visualizerProcessing : null,
      ]}
    >
      {visualizerHeights.map((height, index) => {
        const pulseOffset = (index % 6) / 6;
        const animatedHeight = pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [
            height,
            uiState.shouldAnimateVisualizer
              ? height + 18 + pulseOffset * 18
              : height,
            height,
          ],
        });

        return (
          <Animated.View
            key={index}
            style={[
              styles.visualizerBar,
              {
                backgroundColor: uiState.accentColor,
                height: animatedHeight,
                opacity: uiState.shouldAnimateVisualizer ? 0.85 : 0.45,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export default function VoiceScreen() {
  const teacherMode = useTeacherMode();
  const voiceSession = useVoiceSession({ teacherMode });
  const uiState = resolveVoiceUiState({
    status: voiceSession.status,
    isRecording: voiceSession.isRecording,
    isListening: voiceSession.isListening,
    isPlaying: voiceSession.isPlaying,
  });
  const { styles: animatedStyles, visualizerPulse } =
    useVoiceAnimations(uiState);

  const isConnected =
    uiState.phase === "connected" ||
    uiState.phase === "recording" ||
    uiState.phase === "processing" ||
    uiState.phase === "speaking";

  useEffect(() => {
    void (async () => {
      const session = await getSupabaseSession();
      const accessToken = session?.access_token;
      if (!accessToken) return;
      await teacherMode.loadLessons({
        backendUrl: getRuntimeEnv().backendUrl,
        accessToken,
      });
    })();
  }, [teacherMode]);

  useEffect(() => {
    void voiceSession.connect();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.connectionStatus,
            isConnected ? styles.connected : styles.disconnected,
            { borderColor: uiState.accentColor },
          ]}
        >
          <Animated.View
            style={[
              styles.statusDot,
              { backgroundColor: uiState.accentColor },
              animatedStyles.dot,
            ]}
          />
          <Text style={styles.connectionText}>{uiState.connectionLabel}</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.title}>Галасавы Агент - Юзік</Text>
          {voiceSession.retryNotice ? (
            <Text style={styles.notice}>{voiceSession.retryNotice}</Text>
          ) : null}
          {voiceSession.error ? (
            <Text style={styles.error}>{voiceSession.error}</Text>
          ) : null}
        </View>

        <View style={styles.micStage}>
          <Animated.View
            style={[
              styles.micHalo,
              { backgroundColor: uiState.haloColor },
              animatedStyles.halo,
            ]}
          />
          <Animated.View
            style={[
              styles.micOrb,
              { borderColor: uiState.accentColor },
              uiState.phase === "recording" ? styles.micOrbListening : null,
              uiState.phase === "processing" ? styles.micOrbProcessing : null,
              uiState.phase === "speaking" ? styles.micOrbSpeaking : null,
              animatedStyles.mic,
            ]}
          >
            <Text style={[styles.micIcon, { color: uiState.accentColor }]}>
              {uiState.icon}
            </Text>
          </Animated.View>
        </View>

        <Text
          style={[
            styles.statusText,
            uiState.shouldAnimateVisualizer ? styles.statusTextActive : null,
          ]}
        >
          {uiState.statusLabel}
        </Text>

        <VisualizerBars pulse={visualizerPulse} uiState={uiState} />

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
        isListening={voiceSession.isListening}
        isTeacherActive={teacherMode.isActive}
        onConnect={voiceSession.connect}
        onReconnect={voiceSession.reconnect}
        onStartRecording={voiceSession.startRecording}
        onStopRecording={voiceSession.stopRecording}
        onStartListening={voiceSession.startListening}
        onStopListening={voiceSession.stopListening}
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
    backgroundColor: webTheme.colors.background,
  },
  bgGlowTop: {
    position: "absolute",
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: webTheme.colors.bgGlowPrimary,
  },
  bgGlowBottom: {
    position: "absolute",
    right: -90,
    bottom: 80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: webTheme.colors.bgGlowSecondary,
  },
  content: {
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 14,
    paddingBottom: 28,
  },
  connectionStatus: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: webTheme.radii.pill,
    ...webGlassPanel,
  },
  connected: {
    borderColor: webTheme.colors.speakingBorder,
  },
  disconnected: {
    borderColor: webTheme.colors.listeningBorder,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionText: {
    color: webTheme.colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  hero: {
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
    width: "100%",
  },
  title: {
    ...webTextStyles.title,
    fontSize: 24,
    lineHeight: 30,
    textAlign: "center",
  },
  notice: {
    color: webTheme.colors.processing,
    fontSize: 14,
    textAlign: "center",
  },
  error: {
    color: webTheme.colors.danger,
    fontSize: 14,
    textAlign: "center",
  },
  micStage: {
    alignItems: "center",
    justifyContent: "center",
    height: 152,
    width: "100%",
  },
  micHalo: {
    position: "absolute",
    width: 142,
    height: 142,
    borderRadius: 71,
    backgroundColor: webTheme.colors.primaryGlow,
    opacity: 0.18,
  },
  micOrb: {
    width: 116,
    height: 116,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 58,
    backgroundColor: webTheme.colors.surfaceStrong,
    borderColor: webTheme.colors.border,
    borderWidth: 1,
  },
  micOrbListening: {
    backgroundColor: webTheme.colors.listeningBg,
    borderColor: webTheme.colors.listening,
  },
  micOrbProcessing: {
    backgroundColor: webTheme.colors.processingBg,
    borderColor: webTheme.colors.processing,
  },
  micOrbSpeaking: {
    backgroundColor: webTheme.colors.speakingBg,
    borderColor: webTheme.colors.speaking,
  },
  micIcon: {
    color: webTheme.colors.text,
    fontSize: 46,
  },
  statusText: {
    color: webTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: "400",
    minHeight: 24,
    textAlign: "center",
  },
  statusTextActive: {
    color: webTheme.colors.text,
  },
  visualizer: {
    width: "100%",
    maxWidth: 320,
    height: 84,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  visualizerBar: {
    width: 5,
    borderRadius: 5,
    backgroundColor: webTheme.colors.primary,
    opacity: 0.72,
  },
  visualizerProcessing: {
    opacity: 0.55,
  },
});
