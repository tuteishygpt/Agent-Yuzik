import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ChatAttachment } from "@/lib/file-picker";
import { webGlassPanel, webTheme } from "@/theme/webTheme";

type AttachmentTrayProps = {
  attachment: ChatAttachment | null;
  onClear: () => void;
};

export function AttachmentTray({ attachment, onClear }: AttachmentTrayProps) {
  if (!attachment) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.meta}>
        <Text style={styles.label}>Attachment</Text>
        <Text style={styles.name}>{attachment.name}</Text>
        <Text style={styles.mime}>{attachment.mimeType ?? "unknown type"}</Text>
      </View>
      <Pressable onPress={onClear} style={styles.clearButton}>
        <Text style={styles.clearText}>Remove</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: webTheme.colors.border,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 16,
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  name: {
    color: webTheme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  mime: {
    color: webTheme.colors.textMuted,
    fontSize: 13,
  },
  clearButton: {
    alignSelf: "center",
    borderRadius: 999,
    ...webGlassPanel,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clearText: {
    color: webTheme.colors.text,
    fontWeight: "700",
  },
});
