import { Pressable, StyleSheet, Text, View } from "react-native";

import { webGlassPanel, webTheme } from "@/theme/webTheme";

type VoiceControlsProps = {
  status: string;
  isRecording: boolean;
  isListening: boolean;
  isTeacherActive: boolean;
  onConnect: () => Promise<void> | void;
  onReconnect: () => Promise<void> | void;
  onStartRecording: () => Promise<void> | void;
  onStopRecording: () => Promise<void> | void;
  onStartListening: () => Promise<void> | void;
  onStopListening: () => void;
  onInterrupt: () => Promise<void> | void;
  onStartTeacherLesson: () => Promise<void> | void;
  onStopTeacherLesson: () => Promise<void> | void;
};

export function VoiceControls({
  status,
  isRecording,
  isListening,
  isTeacherActive,
  onConnect,
  onReconnect,
  onStartRecording,
  onStopRecording,
  onStartListening,
  onStopListening,
  onInterrupt,
  onStartTeacherLesson,
  onStopTeacherLesson,
}: VoiceControlsProps) {
  const statusLabel = isRecording
    ? "Слухаю"
    : isListening
      ? "VAD актыўны"
      : status === "processing"
        ? "Думаю"
        : status === "connected"
          ? "Гатова"
          : status;

  const connected = status === "connected" || status === "processing" || isListening || isRecording;

  return (
    <View style={styles.container}>
      <Text style={styles.status}>Voice: {statusLabel}</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => void (isListening ? onStopListening() : onStartListening())}
          style={[styles.primaryButton, isListening ? styles.listeningButton : null]}
          disabled={!connected}
        >
          <Text style={styles.primaryText}>
            {isListening ? "■ Спыніць" : "🎙 Пачаць"}
          </Text>
        </Pressable>
        <Pressable onPress={() => void onInterrupt()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Interrupt</Text>
        </Pressable>
      </View>
      <View style={styles.utilityRow}>
        <Pressable onPress={() => void onReconnect()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Пераканектыць</Text>
        </Pressable>
        <Pressable
          onPress={() => void (isRecording ? onStopRecording() : onStartRecording())}
          style={styles.secondaryButton}
          disabled={!connected}
        >
          <Text style={styles.secondaryText}>
            {isRecording ? "■ Спыніць ручн." : "▶ Ручны запіс"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() =>
            void (isTeacherActive ? onStopTeacherLesson() : onStartTeacherLesson())
          }
          style={styles.teacherButton}
        >
          <Text style={styles.teacherText}>
            {isTeacherActive ? "Stop lesson" : "Start lesson"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: webTheme.colors.border,
    backgroundColor: "rgba(12, 14, 24, 0.96)",
  },
  status: {
    color: webTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  utilityRow: {
    flexDirection: "row",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    borderRadius: webTheme.radii.pill,
    backgroundColor: webTheme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  listeningButton: {
    backgroundColor: webTheme.colors.listening,
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryButton: {
    flex: 1,
    borderRadius: webTheme.radii.pill,
    ...webGlassPanel,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryText: {
    color: webTheme.colors.text,
    fontWeight: "700",
    textAlign: "center",
  },
  teacherButton: {
    flex: 1,
    borderRadius: webTheme.radii.pill,
    backgroundColor: "rgba(168, 240, 200, 0.10)",
    borderColor: "rgba(68, 255, 170, 0.24)",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  teacherText: {
    color: webTheme.colors.teacher,
    fontWeight: "700",
    textAlign: "center",
  },
});
