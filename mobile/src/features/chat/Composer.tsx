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

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS === "web" && e.nativeEvent.key === "Enter" && !(e as any).nativeEvent.shiftKey) {
      e.preventDefault();
      handleSubmitEditing();
    }
  };

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
        <View style={styles.inputContainer}>
          <Pressable onPress={onAttach} style={styles.attachButton}>
            <Text style={styles.iconText}>📎</Text>
          </Pressable>
          <TextInput
            ref={inputRef}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={webTheme.colors.textMuted}
            style={styles.input}
            multiline
            blurOnSubmit={false}
            returnKeyType="send"
            enablesReturnKeyAutomatically
            onSubmitEditing={handleSubmitEditing}
            onKeyPress={handleKeyPress}
            value={draftText}
            onChangeText={onChangeDraftText}
          />
          <Pressable
            onPress={() => {
              void onSend();
              inputRef.current?.focus();
            }}
            disabled={isSending || !draftText.trim()}
            style={[
              styles.sendButton,
              (isSending || !draftText.trim()) && styles.sendButtonDisabled,
            ]}
          >
            <Text style={styles.sendIcon}>➤</Text>
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
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inputContainer: {
    flex: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: webTheme.colors.glassBg,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    borderRadius: 30,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    color: webTheme.colors.text,
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 10,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: webTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    color: "#ffffff",
    fontSize: 18,
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    color: webTheme.colors.textMuted,
    marginTop: 10,
  },
});
