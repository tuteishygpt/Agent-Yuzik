import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ChatAttachment } from "@/lib/file-picker";
import { webTheme } from "@/theme/webTheme";

type AttachmentTrayProps = {
  attachment: ChatAttachment | null;
  onClear: () => void;
};

export function AttachmentTray({ attachment, onClear }: AttachmentTrayProps) {
  if (!attachment) {
    return null;
  }

  const isAudio = attachment.mimeType?.startsWith("audio/") ?? false;

  return (
    <View style={styles.container}>
      <View style={styles.meta}>
        <Text style={styles.label}>{isAudio ? "Галасавое паведамленне" : "Укладанне"}</Text>
        <Text numberOfLines={1} style={styles.name}>
          {attachment.name}
        </Text>
        <Text numberOfLines={1} style={styles.mime}>
          {attachment.mimeType ?? "невядомы тып"}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Remove attachment"
        accessibilityRole="button"
        onPress={onClear}
        style={styles.clearButton}
      >
        <Text style={styles.clearText}>Выдаліць</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: webTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  name: {
    color: webTheme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  mime: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
  },
  clearButton: {
    alignSelf: "center",
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearText: {
    color: webTheme.colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
});
