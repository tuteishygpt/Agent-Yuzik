import { forwardRef, useEffect, useRef } from "react";
import { Animated, FlatList, Image, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";
import { webTheme } from "@/theme/webTheme";
import type { ChatMessage } from "./useChatController";

type MessageListProps = {
  messages: ChatMessage[];
  isSending?: boolean;
};

function MessageCard({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const isUser = message.role === "user";

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      {!isUser && (
        <View style={styles.avatarBot}>
          <Text style={styles.avatarEmoji}>🤖</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
        <Text style={[styles.content, isUser && styles.userContent]}>{message.content}</Text>
        {message.artifact?.kind === "image" ? (
          <Image source={{ uri: message.artifact.localUri }} style={styles.imagePreview} />
        ) : null}
        {message.artifact ? (
          <View style={styles.artifactActions}>
            <Text style={styles.artifact}>
              {message.artifact.kind === "image" ? t("chat.imageCached") : t("chat.audioCached")}
            </Text>
            <View style={styles.actionRow}>
              {message.artifact.kind === "audio" && message.artifact.play ? (
                <Pressable
                  testID="chat-audio-play-button"
                  onPress={() => void message.artifact?.play?.()}
                  style={styles.actionButton}
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
      {isUser && (
        <View style={styles.avatarUser}>
          <Text style={styles.avatarEmoji}>👤</Text>
        </View>
      )}
    </View>
  );
}

function TypingIndicator() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 420,
          useNativeDriver: false,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacity]);

  return (
    <View testID="chat-typing-indicator" style={styles.messageRow}>
      <View style={styles.avatarBot}>
        <Text style={styles.avatarEmoji}>ðŸ¤–</Text>
      </View>
      <View style={[styles.bubble, styles.botBubble, styles.typingBubble]}>
        <Animated.View style={[styles.typingDot, { opacity }]} />
        <Animated.View style={[styles.typingDot, { opacity }]} />
        <Animated.View style={[styles.typingDot, { opacity }]} />
      </View>
    </View>
  );
}

function EmptyState({ onSelectPrompt }: { onSelectPrompt?: (prompt: string) => void }) {
  const { t } = useI18n();

  const promptCards = [
    { icon: "📝", text: t("chat.promptEssay"), sub: t("chat.promptEssaySub"), prompt: t("chat.promptEssay") + " " + t("chat.promptEssaySub").toLowerCase() },
    { icon: "💡", text: t("chat.promptExplain"), sub: t("chat.promptExplainSub"), prompt: t("chat.promptExplain") + " " + t("chat.promptExplainSub").toLowerCase() },
    { icon: "🎨", text: t("chat.promptCreate"), sub: t("chat.promptCreateSub"), prompt: t("chat.promptCreate") + " " + t("chat.promptCreateSub").toLowerCase() },
    { icon: "🗣️", text: t("chat.promptTranslate"), sub: t("chat.promptTranslateSub"), prompt: t("chat.promptTranslate") + " " + t("chat.promptTranslateSub").toLowerCase() },
  ];

  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyLogo}>🤖</Text>
      <Text style={styles.emptyTitle}>{t("chat.emptyTitle")}</Text>
      <Text style={styles.emptySubtitle}>{t("chat.emptySubtitle")}</Text>
      <View style={styles.promptGrid}>
        {promptCards.map((card) => (
          <Pressable
            key={card.text}
            style={styles.promptCard}
            onPress={() => onSelectPrompt?.(card.prompt)}
          >
            <Text style={styles.promptIcon}>{card.icon}</Text>
            <View>
              <Text style={styles.promptText}>{card.text}</Text>
              <Text style={styles.promptSub}>{card.sub}</Text>
            </View>
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
  function MessageList({ messages, isSending = false, onSelectPrompt, onContentSizeChange }, ref) {
    return (
      <FlatList
        ref={ref}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageCard message={item} />}
        ListFooterComponent={isSending ? <TypingIndicator /> : null}
        ListEmptyComponent={<EmptyState onSelectPrompt={onSelectPrompt} />}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onContentSizeChange}
        onScrollBeginDrag={Keyboard.dismiss}
      />
    );
  }
);

const styles = StyleSheet.create({
  listContent: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: "85%",
    alignSelf: "flex-start",
  },
  messageRowUser: {
    alignSelf: "flex-end",
    flexDirection: "row-reverse",
  },
  avatarBot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: webTheme.colors.glassBg,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarUser: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: webTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: {
    fontSize: 18,
  },
  bubble: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: "100%",
    flexShrink: 1,
  },
  userBubble: {
    backgroundColor: webTheme.colors.primary,
    borderBottomRightRadius: 6,
  },
  botBubble: {
    backgroundColor: webTheme.colors.botMsgBg,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    borderBottomLeftRadius: 6,
  },
  content: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  userContent: {
    color: "#ffffff",
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
    color: "#ff4444",
    fontSize: 12,
    marginTop: 8,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 70,
    minHeight: 42,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: webTheme.colors.textMuted,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyLogo: {
    fontSize: 64,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 26,
    fontWeight: "600",
    color: webTheme.colors.primary,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 16,
    color: webTheme.colors.textMuted,
    marginBottom: 28,
  },
  promptGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    maxWidth: 360,
    justifyContent: "center",
  },
  promptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: webTheme.colors.glassBg,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    borderRadius: 16,
    width: "47%",
  },
  promptIcon: {
    fontSize: 22,
  },
  promptText: {
    fontSize: 13,
    color: webTheme.colors.text,
    fontWeight: "500",
  },
  promptSub: {
    fontSize: 11,
    color: webTheme.colors.textMuted,
    marginTop: 2,
  },
});
