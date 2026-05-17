import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ChatAttachment } from "@/lib/file-picker";
import { webGlassPanel, webTheme } from "@/theme/webTheme";

import { AttachmentTray } from "./AttachmentTray";

type ComposerProps = {
  draftText: string;
  onChangeDraftText: (text: string) => void;
  onSend: () => Promise<void> | void;
  onAttach: () => Promise<void> | void;
  onClearAttachment: () => void;
  attachment: ChatAttachment | null;
  isSending: boolean;
};

export function Composer({
  draftText,
  onChangeDraftText,
  onSend,
  onAttach,
  onClearAttachment,
  attachment,
  isSending,
}: ComposerProps) {
  return (
    <View style={styles.container}>
      <AttachmentTray attachment={attachment} onClear={onClearAttachment} />
      <View style={styles.row}>
        <Pressable onPress={onAttach} style={styles.attachButton}>
          <Text style={styles.attachText}>Attach</Text>
        </Pressable>
        <TextInput
          placeholder="Type a message"
          placeholderTextColor={webTheme.colors.textDim}
          style={styles.input}
          multiline
          value={draftText}
          onChangeText={onChangeDraftText}
        />
        <Pressable
          onPress={() => void onSend()}
          style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
        >
          <Text style={styles.sendText}>{isSending ? "Sending" : "Send"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopColor: webTheme.colors.border,
    borderTopWidth: 1,
    backgroundColor: "rgba(12, 14, 24, 0.96)",
  },
  row: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 10,
    padding: 16,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: webTheme.colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: webTheme.colors.text,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  attachButton: {
    borderRadius: 16,
    ...webGlassPanel,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  attachText: {
    color: webTheme.colors.text,
    fontWeight: "700",
  },
  sendButton: {
    borderRadius: 16,
    backgroundColor: webTheme.colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  sendButtonDisabled: {
    opacity: 0.7,
  },
  sendText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
