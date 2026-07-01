import { forwardRef, useEffect, useRef } from "react";
import {
  Animated,
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
      {isUser ? (
        <View style={styles.avatarUser}>
          <Text style={styles.avatarInitial}>U</Text>
        </View>
      ) : null}
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
    <View style={styles.messageRow} testID="chat-typing-indicator">
      <YuzikAvatar size="sm" state="thinking" />
      <View style={[styles.bubble, styles.botBubble, styles.typingBubble]}>
        <Animated.View style={[styles.typingDot, { opacity }]} />
        <Animated.View style={[styles.typingDot, { opacity }]} />
        <Animated.View style={[styles.typingDot, { opacity }]} />
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
    { messages, isSending = false, onSelectPrompt, onContentSizeChange },
    ref,
  ) {
    return (
      <FlatList
        ListEmptyComponent={<EmptyState onSelectPrompt={onSelectPrompt} />}
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
    paddingTop: 0,
    paddingBottom: 18,
  },
  messageRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: "88%",
  },
  messageRowUser: {
    alignSelf: "flex-end",
    flexDirection: "row-reverse",
  },
  avatarUser: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: webTheme.colors.text,
  },
  avatarInitial: {
    color: webTheme.colors.surface,
    fontSize: 13,
    fontWeight: "800",
  },
  bubble: {
    maxWidth: "100%",
    flexShrink: 1,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: webTheme.colors.userMsgBg,
    borderBottomRightRadius: 4,
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
    color: webTheme.colors.surface,
  },
  artifact: {
    marginTop: 8,
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  userArtifact: {
    color: webTheme.colors.surface,
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
    minWidth: 70,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
    justifyContent: "flex-start",
    paddingTop: 146,
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
