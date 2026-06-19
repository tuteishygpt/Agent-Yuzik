import { StyleSheet, Text, View } from "react-native";

import { webTheme } from "@/theme/webTheme";

export type YuzikAvatarState =
  | "default"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type YuzikAvatarProps = {
  state?: YuzikAvatarState;
  size?: "sm" | "md" | "lg";
  label?: string;
};

const stateColors: Record<YuzikAvatarState, string> = {
  default: webTheme.colors.primary,
  listening: webTheme.colors.listening,
  thinking: webTheme.colors.processing,
  speaking: webTheme.colors.speaking,
  error: webTheme.colors.danger,
};

export function YuzikAvatar({
  state = "default",
  size = "md",
  label,
}: YuzikAvatarProps) {
  return (
    <View
      accessibilityLabel={label ?? `Yuzik avatar ${state}`}
      accessible
      style={[
        styles.avatar,
        styles[size],
        { borderColor: stateColors[state] },
      ]}
      testID="yuzik-avatar"
    >
      <Text style={[styles.mark, styles[`${size}Mark`]]}>Y</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: webTheme.colors.surface,
    borderWidth: 2,
    shadowColor: webTheme.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 2,
  },
  sm: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  md: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  lg: {
    width: 112,
    height: 112,
    borderRadius: 56,
  },
  mark: {
    color: webTheme.colors.text,
    fontWeight: "800",
  },
  smMark: {
    fontSize: 16,
  },
  mdMark: {
    fontSize: 24,
  },
  lgMark: {
    fontSize: 48,
  },
});
