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
import { BottomMenuButton } from "@/navigation/BottomMenuButton";
import { webTheme } from "@/theme/webTheme";

import { AttachmentTray } from "./AttachmentTray";

type ComposerProps = {
  draftText: string;
  onChangeDraftText: (text: string) => void;
  onSend: () => Promise<void> | void;
  onAttach: () => Promise<void> | void;
  onClearAttachment: () => void;
  attachment: ChatAttachment | null;
  isSending: boolean;
  onOpenMenu?: () => void;
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

  const sendDisabled = isSending || !draftText.trim();

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 12) + 8 },
      ]}
    >
      <AttachmentTray attachment={attachment} onClear={onClearAttachment} />
      <View style={styles.bottomRow}>
        {onOpenMenu ? <BottomMenuButton onPress={onOpenMenu} /> : null}
        <View style={styles.inputContainer} testID="chat-composer-input-shell">
          <Pressable
            accessibilityLabel="Attach file"
            onPress={onAttach}
            style={styles.attachButton}
          >
            <Text style={styles.iconText}>+</Text>
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
            accessibilityLabel="Send message"
            disabled={sendDisabled}
            onPress={() => {
              void onSend();
              inputRef.current?.focus();
            }}
            style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendIcon}>{">"}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.footer}>{t("chat.footer")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopColor: webTheme.colors.border,
    borderTopWidth: 1,
    backgroundColor: webTheme.colors.background,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputContainer: {
    flex: 1,
    flexShrink: 1,
    minHeight: 54,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  attachButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  iconText: {
    color: webTheme.colors.text,
    fontSize: 22,
    fontWeight: "600",
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
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    color: webTheme.colors.surface,
    fontSize: 18,
    fontWeight: "800",
  },
  footer: {
    marginTop: 8,
    color: webTheme.colors.textMuted,
    fontSize: 12,
    textAlign: "center",
  },
});
