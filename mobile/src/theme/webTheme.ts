import type { TextStyle, ViewStyle } from "react-native";

export const webTheme = {
  colors: {
    primary: "#6495ED",
    primaryHover: "#5080dd",
    primaryGlow: "rgba(100, 149, 237, 0.4)",
    background: "#141423",
    surface: "rgba(255, 255, 255, 0.05)",
    surfaceStrong: "rgba(255, 255, 255, 0.08)",
    surfaceMuted: "rgba(255, 255, 255, 0.035)",
    glassBg: "rgba(20, 20, 35, 0.6)",
    border: "rgba(255, 255, 255, 0.1)",
    borderStrong: "rgba(255, 255, 255, 0.2)",
    text: "#e0e0e0",
    textMuted: "#a0a0a0",
    textDim: "rgba(255, 255, 255, 0.55)",
    userMsgBg: "#6495ED",
    botMsgBg: "rgba(255, 255, 255, 0.08)",
    listening: "#ff4466",
    processing: "#ffaa00",
    speaking: "#44ffaa",
    danger: "#ff6688",
    teacher: "#a8f0c8",
    listeningGlow: "rgba(255, 68, 102, 0.42)",
    listeningBg: "rgba(255, 68, 102, 0.15)",
    listeningBorder: "rgba(255, 68, 102, 0.24)",
    processingGlow: "rgba(255, 170, 0, 0.34)",
    processingBg: "rgba(255, 170, 0, 0.10)",
    speakingGlow: "rgba(68, 255, 170, 0.34)",
    speakingBg: "rgba(68, 255, 170, 0.10)",
    speakingBorder: "rgba(68, 255, 170, 0.28)",
    bgGlowPrimary: "rgba(100, 149, 237, 0.16)",
    bgGlowSecondary: "rgba(167, 139, 250, 0.14)",
  },
  radii: {
    sm: 8,
    md: 10,
    lg: 16,
    xl: 24,
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
