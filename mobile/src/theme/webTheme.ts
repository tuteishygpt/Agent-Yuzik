import type { TextStyle, ViewStyle } from "react-native";

export const webTheme = {
  colors: {
    primary: "#d83324",
    primaryHover: "#b92b20",
    primaryGlow: "rgba(216, 51, 36, 0.18)",
    background: "#f8f5f0",
    surface: "#ffffff",
    surfaceStrong: "#fffaf4",
    surfaceMuted: "#eee6dd",
    glassBg: "#ffffff",
    border: "#e5ddd3",
    borderStrong: "#d8cfc3",
    text: "#1f1d1b",
    textMuted: "#6f6760",
    textDim: "#9a9188",
    userMsgBg: "#d83324",
    botMsgBg: "#ffffff",
    listening: "#d83324",
    processing: "#b7791f",
    speaking: "#26805b",
    danger: "#d83324",
    teacher: "#2f6f56",
    listeningGlow: "rgba(216, 51, 36, 0.18)",
    listeningBg: "rgba(216, 51, 36, 0.10)",
    listeningBorder: "rgba(216, 51, 36, 0.24)",
    processingGlow: "rgba(183, 121, 31, 0.18)",
    processingBg: "rgba(183, 121, 31, 0.10)",
    speakingGlow: "rgba(38, 128, 91, 0.18)",
    speakingBg: "rgba(38, 128, 91, 0.10)",
    speakingBorder: "rgba(38, 128, 91, 0.24)",
    bgGlowPrimary: "rgba(216, 51, 36, 0.08)",
    bgGlowSecondary: "rgba(47, 111, 86, 0.08)",
  },
  radii: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
  },
} as const;

export const webGlassPanel: ViewStyle = {
  backgroundColor: webTheme.colors.surface,
  borderColor: webTheme.colors.border,
  borderWidth: 1,
};

export const webTextStyles = {
  eyebrow: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  } satisfies TextStyle,
  title: {
    color: webTheme.colors.text,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
  } satisfies TextStyle,
  body: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  } satisfies TextStyle,
  muted: {
    color: webTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  } satisfies TextStyle,
};
