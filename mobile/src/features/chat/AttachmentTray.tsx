import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ChatAttachment } from "@/lib/file-picker";
import { webTheme } from "@/theme/webTheme";

type AttachmentTrayProps = {
  attachment: ChatAttachment | null;
  onClear: () => void;
};

const VOICE_WAVEFORM_BARS = [
  8, 10, 7, 12, 16, 11, 8, 14, 20, 24, 18, 12, 9, 13, 19, 22, 17, 10, 8, 12,
  15, 11, 8, 9,
];

function getAttachmentIconStyle(mimeType: string | null) {
  const normalized = mimeType ?? "";

  if (normalized.startsWith("image/")) {
    return styles.fileIconImage;
  }

  if (normalized === "application/pdf") {
    return styles.fileIconPdf;
  }

  if (normalized === "text/plain") {
    return styles.fileIconText;
  }

  return styles.fileIconGeneric;
}

function FileAttachmentIcon({ mimeType }: { mimeType: string | null }) {
  const isImage = mimeType?.startsWith("image/") ?? false;

  return (
    <View
      style={[styles.fileIcon, getAttachmentIconStyle(mimeType)]}
      testID="attachment-file-icon"
    >
      <View style={styles.fileIconCorner} />
      {isImage ? (
        <>
          <View style={styles.fileIconDot} />
          <View style={styles.fileIconMountain} />
        </>
      ) : (
        <>
          <View style={styles.fileIconLine} />
          <View style={[styles.fileIconLine, styles.fileIconLineShort]} />
        </>
      )}
    </View>
  );
}

function ClearIcon({ variant }: { variant: "file" | "voice" }) {
  const iconStyle = variant === "file" ? styles.fileClearIcon : styles.voiceClearIcon;
  const reverseStyle =
    variant === "file" ? styles.fileClearIconReverse : styles.voiceClearIconReverse;

  return (
    <>
      <View style={iconStyle} />
      <View style={[iconStyle, reverseStyle]} />
    </>
  );
}

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
          <ClearIcon variant="voice" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fileContainer}>
      <FileAttachmentIcon mimeType={attachment.mimeType} />
      <Text numberOfLines={1} style={styles.fileName}>
        {attachment.name}
      </Text>
      <Pressable
        accessibilityLabel="Remove attachment"
        accessibilityRole="button"
        onPress={onClear}
        style={styles.fileClearButton}
      >
        <ClearIcon variant="file" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fileContainer: {
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
  fileIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
  },
  fileIconImage: {
    backgroundColor: "rgba(211, 61, 56, 0.10)",
    borderColor: "rgba(211, 61, 56, 0.22)",
  },
  fileIconPdf: {
    backgroundColor: "rgba(211, 61, 56, 0.12)",
    borderColor: "rgba(211, 61, 56, 0.24)",
  },
  fileIconText: {
    backgroundColor: "rgba(69, 69, 69, 0.08)",
    borderColor: "rgba(69, 69, 69, 0.14)",
  },
  fileIconGeneric: {
    backgroundColor: webTheme.colors.surfaceStrong,
    borderColor: webTheme.colors.border,
  },
  fileIconCorner: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 12,
    height: 12,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(69, 69, 69, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  fileIconDot: {
    position: "absolute",
    top: 11,
    left: 11,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: webTheme.colors.primary,
    opacity: 0.7,
  },
  fileIconMountain: {
    width: 17,
    height: 10,
    marginTop: 10,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: webTheme.colors.primary,
    opacity: 0.72,
    transform: [{ rotate: "-35deg" }],
  },
  fileIconLine: {
    width: 16,
    height: 2,
    marginVertical: 2,
    borderRadius: 1,
    backgroundColor: webTheme.colors.primary,
    opacity: 0.68,
  },
  fileIconLineShort: {
    width: 11,
    alignSelf: "flex-start",
    marginLeft: 10,
  },
  fileName: {
    flex: 1,
    minWidth: 0,
    color: webTheme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  fileClearButton: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  fileClearIcon: {
    position: "absolute",
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: webTheme.colors.textMuted,
    transform: [{ rotate: "45deg" }],
  },
  fileClearIconReverse: {
    transform: [{ rotate: "-45deg" }],
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
    minWidth: 44,
    minHeight: 44,
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
