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

  if (isAudio) {
    return (
      <View style={styles.voiceContainer}>
        <View style={styles.voicePlayButton} testID="attachment-voice-play-icon">
          <View style={styles.voicePlayIcon} />
        </View>
        <View style={styles.voiceWaveform} testID="attachment-voice-waveform">
          {VOICE_WAVEFORM_BARS.map((height, index) => (
            <View
              key={`${height}-${index}`}
              style={[
                styles.voiceWaveformBar,
                {
                  height,
                  opacity: height > 14 ? 0.85 : 0.5,
                },
              ]}
            />
          ))}
        </View>
        <Pressable
          accessibilityLabel="Remove attachment"
          accessibilityRole="button"
          onPress={onClear}
          style={styles.voiceClearButton}
        >
          <View style={styles.voiceClearIcon} />
          <View style={[styles.voiceClearIcon, styles.voiceClearIconReverse]} />
        </Pressable>
      </View>
    );
  }

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

const VOICE_WAVEFORM_BARS = [
  8, 10, 7, 12, 16, 11, 8, 14, 20, 24, 18, 12, 9, 13, 19, 22, 17, 10, 8, 12,
  15, 11, 8, 9,
];

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
  voiceContainer: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 27,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.borderStrong,
  },
  voicePlayButton: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: webTheme.colors.primary,
  },
  voicePlayIcon: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: webTheme.colors.surface,
  },
  voiceWaveform: {
    height: 28,
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    overflow: "hidden",
  },
  voiceWaveformBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: webTheme.colors.primary,
  },
  voiceClearButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  voiceClearIcon: {
    position: "absolute",
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: webTheme.colors.textMuted,
    transform: [{ rotate: "45deg" }],
  },
  voiceClearIconReverse: {
    transform: [{ rotate: "-45deg" }],
  },
});
