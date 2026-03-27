import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ChatAttachment } from "@/lib/file-picker";

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
          placeholderTextColor="#98a2b3"
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
    borderTopColor: "#e4e7ec",
    borderTopWidth: 1,
    backgroundColor: "#fff",
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
    borderColor: "#d0d5dd",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#101828",
    backgroundColor: "#fff",
  },
  attachButton: {
    borderRadius: 16,
    backgroundColor: "#eef4ff",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  attachText: {
    color: "#1849a9",
    fontWeight: "700",
  },
  sendButton: {
    borderRadius: 16,
    backgroundColor: "#101828",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  sendButtonDisabled: {
    opacity: 0.7,
  },
  sendText: {
    color: "#fff",
    fontWeight: "700",
  },
});
