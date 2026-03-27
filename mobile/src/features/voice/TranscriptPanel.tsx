import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { VoiceTranscriptEntry } from "./useVoiceSession";

type TranscriptPanelProps = {
  transcript: VoiceTranscriptEntry[];
};

export function TranscriptPanel({ transcript }: TranscriptPanelProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {transcript.length === 0 ? (
        <Text style={styles.empty}>No voice turns yet.</Text>
      ) : (
        transcript.map((entry) => (
          <View key={entry.id} style={styles.entry}>
            <Text style={styles.role}>
              {entry.role === "assistant"
                ? "Assistant"
                : entry.role === "user"
                  ? "You"
                  : "System"}
            </Text>
            <Text style={styles.text}>{entry.text}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 16,
  },
  empty: {
    color: "#667085",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  entry: {
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    backgroundColor: "#ffffff",
    padding: 14,
  },
  role: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  text: {
    color: "#101828",
    fontSize: 15,
    lineHeight: 22,
  },
});
