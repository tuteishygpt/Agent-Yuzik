import { useEffect, useRef } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

import { webGlassPanel, webTheme } from "@/theme/webTheme";
import type { VoiceTranscriptEntry } from "./useVoiceSession";

type TranscriptPanelProps = {
  transcript: VoiceTranscriptEntry[];
};

function TranscriptTurn({ entry }: { entry: VoiceTranscriptEntry }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.entry,
        entry.role === "user" ? styles.userEntry : null,
        entry.role === "assistant" ? styles.assistantEntry : null,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={styles.role}>
        {entry.role === "assistant"
          ? "Настаўнік"
          : entry.role === "user"
            ? "Вучань"
            : "Сістэма"}
      </Text>
      <Text style={styles.text}>{entry.text}</Text>
    </Animated.View>
  );
}

export function TranscriptPanel({ transcript }: TranscriptPanelProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Дыялог</Text>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      {transcript.length === 0 ? (
        <Text style={styles.empty}>Размова яшчэ не пачалася</Text>
      ) : (
        transcript.map((entry) => (
          <TranscriptTurn key={entry.id} entry={entry} />
        ))
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    maxHeight: 320,
    borderRadius: webTheme.radii.xl,
    padding: 16,
    ...webGlassPanel,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  label: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  scroll: {
    minHeight: 130,
  },
  content: {
    gap: 12,
    paddingBottom: 4,
  },
  empty: {
    color: "rgba(255, 255, 255, 0.56)",
    fontSize: 16,
    lineHeight: 24,
    padding: 18,
    textAlign: "center",
    borderRadius: webTheme.radii.lg,
    borderColor: webTheme.colors.border,
    borderStyle: "dashed",
    borderWidth: 1,
  },
  entry: {
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    padding: 14,
  },
  userEntry: {
    borderColor: "rgba(96, 160, 255, 0.18)",
    backgroundColor: "rgba(78, 130, 238, 0.10)",
  },
  assistantEntry: {
    borderColor: "rgba(68, 255, 170, 0.16)",
    backgroundColor: "rgba(68, 255, 170, 0.08)",
  },
  role: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  text: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});
