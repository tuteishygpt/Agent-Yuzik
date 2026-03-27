import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";

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
    color: "#667085",
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 24,
    textAlign: "center",
  },
  card: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
  },
  userCard: {
    alignSelf: "flex-end",
    backgroundColor: "#fff6ed",
    borderColor: "#f4d7b8",
  },
  assistantCard: {
    alignSelf: "flex-start",
    backgroundColor: "#f3f7ff",
    borderColor: "#c7d4f7",
  },
  role: {
    color: "#667085",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  content: {
    color: "#101828",
    fontSize: 16,
    lineHeight: 24,
  },
  artifact: {
    color: "#475467",
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
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d0d5dd",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: {
    color: "#344054",
    fontSize: 12,
    fontWeight: "700",
  },
  imagePreview: {
    width: 180,
    height: 180,
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: "#e4e7ec",
  },
  artifactError: {
    color: "#b42318",
    fontSize: 12,
    marginTop: 8,
  },
});
