import { forwardRef } from "react";
import {
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { YuzikAvatar } from "@/components/mobile";
import { useI18n } from "@/lib/i18n";
import { webTheme } from "@/theme/webTheme";

import type { ChatMessage } from "./useChatController";

type MessageListProps = {
  messages: ChatMessage[];
  isSending?: boolean;
  showStartScreen?: boolean;
};

function MessageCard({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const isUser = message.role === "user";

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      {!isUser ? <YuzikAvatar size="sm" state="default" /> : null}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
        {message.content ? (
          <Text style={[styles.content, isUser && styles.userContent]}>
            {message.content}
          </Text>
        ) : null}
        {message.artifact?.kind === "image" ? (
          <Image source={{ uri: message.artifact.localUri }} style={styles.imagePreview} />
        ) : null}
        {message.artifact ? (
          <View style={styles.artifactActions}>
            <Text style={[styles.artifact, isUser && styles.userArtifact]}>
              {message.artifact.kind === "image"
                ? t("chat.imageCached")
                : t("chat.audioCached")}
            </Text>
            <View style={styles.actionRow}>
              {message.artifact.kind === "audio" && message.artifact.play ? (
                <Pressable
                  onPress={() => void message.artifact?.play?.()}
                  style={styles.actionButton}
                  testID="chat-audio-play-button"
                >
                  <Text style={styles.actionText}>{t("chat.play")}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void message.artifact?.openInSystem()}
                style={styles.actionButton}
              >
                <Text style={styles.actionText}>{t("chat.open")}</Text>
              </Pressable>
              <Pressable
                onPress={() => void message.artifact?.share()}
                style={styles.actionButton}
              >
                <Text style={styles.actionText}>{t("chat.share")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {message.artifactError ? (
          <Text style={styles.artifactError}>{message.artifactError}</Text>
        ) : null}
      </View>
    </View>
  );
}

function TypingIndicator() {
  return (
    <View style={styles.messageRow} testID="chat-typing-indicator">
      <YuzikAvatar size="sm" state="thinking" />
      <View style={[styles.bubble, styles.botBubble, styles.typingBubble]}>
        <Text style={styles.typingText}>Думаю...</Text>
      </View>
    </View>
  );
}

function EmptyState({ onSelectPrompt }: { onSelectPrompt?: (prompt: string) => void }) {
  const promptCards = [
    {
      text: "Патлумач слова",
      prompt: "Патлумач слова",
      style: styles.promptChipWide,
    },
    {
      text: "Ствары выяву",
      prompt: "Ствары выяву",
      style: styles.promptChipNarrow,
    },
    {
      text: "Практыка мовы",
      prompt: "Практыка мовы",
      style: styles.promptChipCentered,
    },
  ];

  return (
    <View style={styles.emptyState}>
      <YuzikAvatar size="figma" state="default" />
      <View style={styles.emptyCopy}>
        <Text style={styles.emptyTitle}>Вітаю, я Юзік</Text>
        <Text style={styles.emptySubtitle}>
          Я дапамагаю пісаць, гаварыць і ствараць па-беларуску
        </Text>
      </View>
      <View style={styles.promptGrid}>
        {promptCards.map((card) => (
          <Pressable
            key={card.text}
            onPress={() => onSelectPrompt?.(card.prompt)}
            style={[styles.promptCard, card.style]}
            accessibilityLabel={card.text}
            testID="chat-empty-prompt"
          >
            <Text style={styles.promptText}>{card.text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type MessageListFullProps = MessageListProps & {
  onSelectPrompt?: (prompt: string) => void;
  onContentSizeChange?: () => void;
};

export const MessageList = forwardRef<FlatList, MessageListFullProps>(
  function MessageList(
    {
      messages,
      isSending = false,
      showStartScreen = true,
      onSelectPrompt,
      onContentSizeChange,
    },
    ref,
  ) {
    return (
      <FlatList
        ListEmptyComponent={
          showStartScreen ? (
            <EmptyState onSelectPrompt={onSelectPrompt} />
          ) : (
            <View style={styles.blankState} />
          )
        }
        ListFooterComponent={isSending ? <TypingIndicator /> : null}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        onContentSizeChange={onContentSizeChange}
        onScrollBeginDrag={Keyboard.dismiss}
        ref={ref}
        renderItem={({ item }) => <MessageCard message={item} />}
      />
    );
  },
);

const styles = StyleSheet.create({
  listContent: {
    flexGrow: 1,
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 18,
  },
  messageRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: "92%",
  },
  messageRowUser: {
    alignSelf: "flex-end",
    justifyContent: "flex-end",
    maxWidth: "78%",
  },
  bubble: {
    maxWidth: "100%",
    flexShrink: 1,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: webTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: webTheme.colors.borderStrong,
  },
  botBubble: {
    backgroundColor: webTheme.colors.botMsgBg,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    borderBottomLeftRadius: 4,
  },
  content: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  userContent: {
    color: webTheme.colors.text,
  },
  artifact: {
    marginTop: 8,
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  userArtifact: {
    color: webTheme.colors.textMuted,
  },
  artifactActions: {
    gap: 8,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: {
    color: webTheme.colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  imagePreview: {
    width: 180,
    height: 180,
    marginTop: 10,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surfaceMuted,
  },
  artifactError: {
    marginTop: 8,
    color: webTheme.colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
  typingBubble: {
    minWidth: 78,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
  },
  typingText: {
    color: webTheme.colors.text,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },
  blankState: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 116,
  },
  emptyTitle: {
    color: webTheme.colors.text,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 25,
    textAlign: "center",
  },
  emptySubtitle: {
    width: 237,
    color: webTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 19,
    textAlign: "center",
  },
  emptyCopy: {
    width: 237,
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  promptGrid: {
    width: 311,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: 12,
    rowGap: 12,
    marginTop: 16,
  },
  promptCard: {
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  promptChipWide: {
    width: 155,
  },
  promptChipNarrow: {
    width: 143,
  },
  promptChipCentered: {
    width: 209,
  },
  promptText: {
    color: webTheme.colors.text,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
