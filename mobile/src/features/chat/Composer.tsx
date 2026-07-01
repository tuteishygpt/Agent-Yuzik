import { useRef } from "react";
import {
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChatAttachment } from "@/lib/file-picker";
import { useI18n } from "@/lib/i18n";
import { webTheme } from "@/theme/webTheme";

import { AttachmentTray } from "./AttachmentTray";

function VoiceIcon() {
  return (
    <View style={styles.voiceIcon} testID="composer-voice-icon">
      <View style={styles.voiceGlyphTop} />
      <View style={styles.voiceGlyphBody} />
      <View style={styles.voiceGlyphStem} />
      <View style={styles.voiceGlyphBase} />
    </View>
  );
}

function SendIcon() {
  return (
    <View style={styles.sendGlyph} testID="composer-send-icon">
      <View style={styles.sendGlyphOuterTop} />
      <View style={styles.sendGlyphOuterBottom} />
      <View style={styles.sendGlyphInnerTop} />
      <View style={styles.sendGlyphInnerBottom} />
      <View style={styles.sendGlyphMiddle} />
    </View>
  );
}

function RecordingWave() {
  return (
    <View style={styles.recordingWave} testID="voice-recording-wave">
      {Array.from({ length: 36 }).map((_, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          style={[
            styles.recordingDot,
            index % 5 === 0 ? styles.recordingDotTall : null,
            index % 7 === 0 ? styles.recordingDotShort : null,
          ]}
        />
      ))}
    </View>
  );
}

type ComposerProps = {
  draftText: string;
  onChangeDraftText: (text: string) => void;
  onSend: () => Promise<void> | void;
  onAttach: () => Promise<void> | void;
  onClearAttachment: () => void;
  attachment: ChatAttachment | null;
  isSending: boolean;
  onOpenMenu?: () => void;
  onStartVoiceRecording?: () => Promise<void> | void;
  onStopVoiceRecording?: () => Promise<void> | void;
  onConfirmVoiceRecording?: () => Promise<void> | void;
  onCancelVoiceRecording?: () => Promise<void> | void;
  isRecordingVoice?: boolean;
};

export function Composer({
  draftText,
  onChangeDraftText,
  onSend,
  onAttach,
  onClearAttachment,
  attachment,
  isSending,
  onOpenMenu,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onConfirmVoiceRecording,
  onCancelVoiceRecording,
  isRecordingVoice = false,
}: ComposerProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const handleSubmitEditing = () => {
    if (draftText.trim() && !isSending) {
      void onSend();
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    if (
      Platform.OS === "web" &&
      e.nativeEvent.key === "Enter" &&
      !(e as any).nativeEvent.shiftKey
    ) {
      e.preventDefault();
      handleSubmitEditing();
    }
  };

  const canSend = Boolean(draftText.trim() || attachment);
  const sendDisabled = isSending || !canSend;
  const showVoiceAction = !canSend && Boolean(onStartVoiceRecording && onStopVoiceRecording);
  const confirmVoiceRecording = onConfirmVoiceRecording ?? onStopVoiceRecording;

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 12) + 8 },
      ]}
    >
      <AttachmentTray attachment={attachment} onClear={onClearAttachment} />
      <View style={styles.bottomRow}>
        <View style={styles.inputContainer} testID="chat-composer-input-shell">
          {isRecordingVoice ? (
            <>
              <RecordingWave />
              <Pressable
                accessibilityLabel="Send voice message"
                disabled={isSending}
                onPress={() => {
                  void confirmVoiceRecording?.();
                }}
                style={[styles.recordingAction, styles.recordingConfirm]}
              >
                <Text style={styles.recordingConfirmIcon}>✓</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Cancel voice message"
                disabled={isSending}
                onPress={() => {
                  void onCancelVoiceRecording?.();
                }}
                style={styles.recordingAction}
              >
                <Text style={styles.recordingCancelIcon}>×</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                accessibilityLabel="Attach file"
                disabled={isSending}
                onPress={() => {
                  void onAttach();
                }}
                style={styles.inlineAttachButton}
              >
                <Text style={styles.attachIcon}>+</Text>
              </Pressable>
              <TextInput
                blurOnSubmit={false}
                enablesReturnKeyAutomatically
                multiline
                onChangeText={onChangeDraftText}
                onKeyPress={handleKeyPress}
                onSubmitEditing={handleSubmitEditing}
                placeholder={t("chat.placeholder")}
                placeholderTextColor={webTheme.colors.textDim}
                ref={inputRef}
                returnKeyType="send"
                style={styles.input}
                value={draftText}
              />
              <Pressable
                accessibilityLabel={showVoiceAction ? "Start voice message" : "Send message"}
                disabled={showVoiceAction ? isSending : sendDisabled}
                onPress={
                  showVoiceAction
                    ? () => {
                        void onStartVoiceRecording?.();
                      }
                    : () => {
                        void onSend();
                        inputRef.current?.focus();
                      }
                }
                style={[
                  styles.sendButton,
                  showVoiceAction ? styles.voiceButton : null,
                  !showVoiceAction && sendDisabled ? styles.sendButtonDisabled : null,
                ]}
              >
                {showVoiceAction ? <VoiceIcon /> : <SendIcon />}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: webTheme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  inputContainer: {
    flex: 1,
    flexShrink: 1,
    minHeight: webTheme.sizes.inputHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: webTheme.radii.textBar,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  inlineAttachButton: {
    width: webTheme.sizes.inputControl,
    height: webTheme.sizes.inputControl,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.sizes.inputControl / 2,
    backgroundColor: webTheme.colors.surface,
  },
  attachIcon: {
    color: webTheme.colors.text,
    fontSize: 28,
    fontWeight: "300",
    lineHeight: 30,
  },
  input: {
    flex: 1,
    maxHeight: 118,
    paddingVertical: 9,
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  sendButton: {
    width: webTheme.sizes.inputControl,
    height: webTheme.sizes.inputControl,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.sizes.inputControl / 2,
    backgroundColor: webTheme.colors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  voiceButton: {
    backgroundColor: webTheme.colors.primary,
  },
  sendGlyph: {
    width: 20,
    height: 20,
  },
  sendGlyphOuterTop: {
    position: "absolute",
    left: 1,
    top: 5,
    width: 19,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.surface,
    transform: [{ rotate: "24deg" }],
  },
  sendGlyphOuterBottom: {
    position: "absolute",
    left: 1,
    bottom: 5,
    width: 19,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.surface,
    transform: [{ rotate: "-24deg" }],
  },
  sendGlyphInnerTop: {
    position: "absolute",
    left: 1,
    top: 5,
    width: 5,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.surface,
    transform: [{ rotate: "76deg" }],
  },
  sendGlyphInnerBottom: {
    position: "absolute",
    left: 1,
    bottom: 5,
    width: 5,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.surface,
    transform: [{ rotate: "-76deg" }],
  },
  sendGlyphMiddle: {
    position: "absolute",
    left: 4,
    top: 9,
    width: 16,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.surface,
  },
  voiceIcon: {
    width: 20,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceGlyphTop: {
    position: "absolute",
    top: 1,
    width: 9,
    height: 14,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: webTheme.colors.surface,
  },
  voiceGlyphBody: {
    position: "absolute",
    top: 12,
    width: 17,
    height: 8,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderColor: webTheme.colors.surface,
  },
  voiceGlyphStem: {
    position: "absolute",
    top: 19,
    width: 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: webTheme.colors.surface,
  },
  voiceGlyphBase: {
    position: "absolute",
    bottom: -1,
    width: 12,
    height: 2,
    borderRadius: 2,
    backgroundColor: webTheme.colors.surface,
  },
  recordingWave: {
    flex: 1,
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingLeft: 8,
  },
  recordingDot: {
    width: 3,
    height: 4,
    borderRadius: 2,
    backgroundColor: webTheme.colors.borderStrong,
  },
  recordingDotTall: {
    height: 6,
  },
  recordingDotShort: {
    height: 3,
  },
  recordingAction: {
    width: webTheme.sizes.inputControl,
    height: webTheme.sizes.inputControl,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.sizes.inputControl / 2,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    backgroundColor: webTheme.colors.surface,
  },
  recordingConfirm: {
    borderColor: webTheme.colors.border,
  },
  recordingConfirmIcon: {
    color: webTheme.colors.text,
    fontSize: 20,
    lineHeight: 22,
  },
  recordingCancelIcon: {
    color: webTheme.colors.text,
    fontSize: 28,
    fontWeight: "300",
    lineHeight: 30,
  },
});
