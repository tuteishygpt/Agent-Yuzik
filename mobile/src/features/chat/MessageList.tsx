import { forwardRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import {
  FlatList,
  Image,
  Keyboard,
  Modal,
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

const AUDIO_WAVEFORM_BARS = [
  7, 8, 7, 9, 8, 7, 10, 15, 21, 24, 19, 13, 9, 13, 18, 22, 20, 14, 10, 16,
  25, 19, 9, 7, 8, 7, 7, 8, 7, 7,
];

function formatAudioDuration(durationSeconds: number): string {
  const normalizedDuration = Math.max(
    0,
    Math.floor(Number.isFinite(durationSeconds) ? durationSeconds : 0),
  );
  const minutes = Math.floor(normalizedDuration / 60);
  const seconds = normalizedDuration % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function AudioArtifactPreview({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;

  function togglePlayback(): void {
    if (isPlaying) {
      player.pause();
      return;
    }

    player.play();
  }

  return (
    <Pressable
      accessibilityLabel="Play audio message"
      onPress={togglePlayback}
      style={styles.audioMessage}
      testID="chat-audio-play-button"
    >
      <View style={styles.audioPlayButton}>
        {isPlaying ? (
          <View style={styles.audioPauseIcon} testID="chat-audio-pause-icon">
            <View style={styles.audioPauseBar} />
            <View style={styles.audioPauseBar} />
          </View>
        ) : (
          <View style={styles.audioPlayIcon} testID="chat-audio-play-icon" />
        )}
      </View>
      <View style={styles.audioContent}>
        <View style={styles.audioWaveform} testID="chat-audio-waveform">
          {AUDIO_WAVEFORM_BARS.map((height, index) => (
            <View
              key={`${height}-${index}`}
              style={[
                styles.audioWaveformBar,
                {
                  height,
                  opacity: height > 14 ? 0.82 : 0.5,
                },
              ]}
            />
          ))}
        </View>
        <Text style={styles.audioDuration}>
          {formatAudioDuration(status.duration)}
        </Text>
      </View>
    </Pressable>
  );
}

function MessageCard({
  message,
  onOpenImage,
}: {
  message: ChatMessage;
  onOpenImage: (uri: string) => void;
}) {
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
          <Pressable
            accessibilityLabel="Open image fullscreen"
            onPress={() => onOpenImage(message.artifact!.localUri)}
            testID="chat-image-preview-button"
          >
            <Image
              source={{ uri: message.artifact.localUri }}
              style={styles.imagePreview}
              testID="chat-image-preview"
            />
          </Pressable>
        ) : null}
        {message.artifact ? (
          <View style={styles.artifactActions}>
            {message.artifact.kind === "image" ? (
              <Text style={[styles.artifact, isUser && styles.userArtifact]}>
                {t("chat.imageCached")}
              </Text>
            ) : null}
            {message.artifact.kind === "audio" && message.artifact.play ? (
              <AudioArtifactPreview uri={message.artifact.localUri} />
            ) : null}
          </View>
        ) : null}
        {message.artifactError ? (
          <Text style={styles.artifactError}>{message.artifactError}</Text>
        ) : null}
      </View>
    </View>
  );
}

function ImagePreviewModal({
  imageUri,
  onClose,
}: {
  imageUri: string | null;
  onClose: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(imageUri)}>
      <View style={styles.fullscreenOverlay}>
        <Pressable
          accessibilityLabel="Close image preview"
          onPress={onClose}
          style={styles.fullscreenClose}
        >
          <Text style={styles.fullscreenCloseText}>X</Text>
        </Pressable>
        {imageUri ? (
          <Image
            resizeMode="contain"
            source={{ uri: imageUri }}
            style={styles.fullscreenImage}
            testID="chat-fullscreen-image"
          />
        ) : null}
      </View>
    </Modal>
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
    const [fullscreenImageUri, setFullscreenImageUri] = useState<string | null>(null);

    return (
      <>
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
          renderItem={({ item }) => (
            <MessageCard message={item} onOpenImage={setFullscreenImageUri} />
          )}
        />
        <ImagePreviewModal
          imageUri={fullscreenImageUri}
          onClose={() => setFullscreenImageUri(null)}
        />
      </>
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
  audioMessage: {
    width: 304,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: webTheme.radii.xl,
    backgroundColor: webTheme.colors.userMsgBg,
    borderWidth: 1,
    borderColor: webTheme.colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  audioPlayButton: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: webTheme.colors.surface,
  },
  audioPlayIcon: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderLeftWidth: 14,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: webTheme.colors.primary,
  },
  audioPauseIcon: {
    width: 16,
    height: 18,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  audioPauseBar: {
    width: 5,
    height: 18,
    borderRadius: 2,
    backgroundColor: webTheme.colors.primary,
  },
  audioContent: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  audioWaveform: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    overflow: "hidden",
  },
  audioWaveformBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: webTheme.colors.surface,
  },
  audioDuration: {
    color: webTheme.colors.surface,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  imagePreview: {
    width: 180,
    height: 180,
    marginTop: 10,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surfaceMuted,
  },
  fullscreenOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(14, 9, 9, 0.92)",
  },
  fullscreenImage: {
    width: "100%",
    height: "100%",
  },
  fullscreenClose: {
    position: "absolute",
    top: 44,
    right: 16,
    zIndex: 1,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(255, 253, 253, 0.14)",
  },
  fullscreenCloseText: {
    color: webTheme.colors.surface,
    fontSize: 30,
    fontWeight: "300",
    lineHeight: 32,
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
    paddingTop: 64,
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
    width: "100%",
    maxWidth: 311,
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
