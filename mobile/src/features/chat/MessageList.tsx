import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { webTheme } from "@/theme/webTheme";
import type { ChatMessage } from "./useChatController";

type MessageListProps = {
  messages: ChatMessage[];
};

function MessageCard({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <View style={[styles.card, isAssistant ? styles.assistantCard : styles.userCard]}>
      <Text style={styles.role}>{isAssistant ? "Assistant" : "You"}</Text>
      <Text style={styles.content}>{message.content}</Text>
      {message.artifact?.kind === "image" ? (
        <Image source={{ uri: message.artifact.localUri }} style={styles.imagePreview} />
      ) : null}
      {message.artifact ? (
        <View style={styles.artifactActions}>
          <Text style={styles.artifact}>
            {message.artifact.kind === "image" ? "Image cached" : "Audio cached"}
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => void message.artifact?.openInSystem()}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Open</Text>
            </Pressable>
            <Pressable
              onPress={() => void message.artifact?.share()}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {message.artifactError ? (
        <Text style={styles.artifactError}>{message.artifactError}</Text>
      ) : null}
    </View>
  );
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageCard message={item} />}
      ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  empty: {
    color: webTheme.colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 24,
    textAlign: "center",
  },
  card: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    maxWidth: "92%",
  },
  userCard: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(78, 130, 238, 0.12)",
    borderColor: "rgba(96, 160, 255, 0.18)",
  },
  assistantCard: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(68, 255, 170, 0.08)",
    borderColor: "rgba(68, 255, 170, 0.16)",
  },
  role: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  content: {
    color: webTheme.colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  artifact: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },
  artifactActions: {
    gap: 8,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: {
    color: webTheme.colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  imagePreview: {
    width: 180,
    height: 180,
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  artifactError: {
    color: webTheme.colors.danger,
    fontSize: 12,
    marginTop: 8,
  },
});
