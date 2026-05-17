import type { TextStyle, ViewStyle } from "react-native";

export const webTheme = {
  colors: {
    primary: "#4e82ee",
    primaryGlow: "rgba(78, 130, 238, 0.4)",
    background: "#0f111a",
    surface: "rgba(255, 255, 255, 0.05)",
    surfaceStrong: "rgba(255, 255, 255, 0.08)",
    surfaceMuted: "rgba(255, 255, 255, 0.035)",
    border: "rgba(255, 255, 255, 0.12)",
    borderStrong: "rgba(255, 255, 255, 0.2)",
    text: "#f0f0f0",
    textMuted: "#a0a0b0",
    textDim: "rgba(255, 255, 255, 0.55)",
    listening: "#ff4466",
    processing: "#ffaa00",
    speaking: "#44ffaa",
    danger: "#ff6688",
    teacher: "#a8f0c8",
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
