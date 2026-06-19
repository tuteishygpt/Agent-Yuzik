import { useEffect, useRef } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

import { webTheme } from "@/theme/webTheme";

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

  const isUser = entry.role === "user";

  return (
    <Animated.View
      style={[
        styles.entry,
        isUser ? styles.userEntry : styles.assistantEntry,
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
      <Text style={[styles.text, isUser ? styles.userText : null]}>
        {entry.text}
      </Text>
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
        contentContainerStyle={styles.content}
        onContentSizeChange={scrollToLatest}
        ref={scrollRef}
        style={styles.scroll}
      >
        {visibleTranscript.length === 0 ? (
          <Text style={styles.empty}>Размова яшчэ не пачалася</Text>
        ) : (
          visibleTranscript.map((entry) => (
            <TranscriptTurn entry={entry} key={entry.id} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    maxHeight: 340,
    borderRadius: webTheme.radii.lg,
    padding: 10,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  scroll: {
    minHeight: 150,
  },
  content: {
    gap: 8,
    paddingBottom: 4,
  },
  empty: {
    padding: 18,
    borderRadius: webTheme.radii.md,
    borderColor: webTheme.colors.border,
    borderStyle: "dashed",
    borderWidth: 1,
    color: webTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  entry: {
    maxWidth: "86%",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userEntry: {
    alignSelf: "flex-end",
    backgroundColor: webTheme.colors.userMsgBg,
    borderColor: webTheme.colors.userMsgBg,
    borderBottomRightRadius: 4,
  },
  assistantEntry: {
    alignSelf: "flex-start",
    backgroundColor: webTheme.colors.botMsgBg,
    borderColor: webTheme.colors.border,
    borderBottomLeftRadius: 4,
  },
  text: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: webTheme.colors.surface,
  },
});
