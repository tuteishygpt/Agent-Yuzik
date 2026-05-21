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
      <Text style={styles.text}>{entry.text}</Text>
    </Animated.View>
  );
}

export function TranscriptPanel({ transcript }: TranscriptPanelProps) {
  const scrollRef = useRef<ScrollView>(null);
  const visibleTranscript = transcript.filter((entry) => entry.role !== "system");
  const scrollToLatest = () => {
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    scrollToLatest();
  }, [visibleTranscript.length]);

  return (
    <View style={styles.panel}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        onContentSizeChange={scrollToLatest}
        style={styles.scroll}
      >
      {visibleTranscript.length === 0 ? (
        <Text style={styles.empty}>Размова яшчэ не пачалася</Text>
      ) : (
        visibleTranscript.map((entry) => (
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
    maxHeight: 360,
    borderRadius: webTheme.radii.lg,
    padding: 10,
    ...webGlassPanel,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  scroll: {
    minHeight: 150,
  },
  content: {
    gap: 8,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userEntry: {
    borderColor: "rgba(96, 160, 255, 0.18)",
    backgroundColor: "rgba(78, 130, 238, 0.10)",
  },
  assistantEntry: {
    borderColor: "rgba(68, 255, 170, 0.16)",
    backgroundColor: "rgba(68, 255, 170, 0.08)",
  },
  text: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});
