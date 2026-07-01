import { Image, StyleSheet, View } from "react-native";

import { webTheme } from "@/theme/webTheme";

export type YuzikAvatarState =
  | "default"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type YuzikAvatarProps = {
  state?: YuzikAvatarState;
  size?: "sm" | "md" | "figma" | "lg";
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
      <Image
        resizeMode="cover"
        source={require("../../../yuzik_ico.png")}
        style={[styles.image, styles[`${size}Image`]]}
      />
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
  figma: {
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  lg: {
    width: 206,
    height: 206,
    borderRadius: 103,
  },
  image: {
    borderRadius: 999,
  },
  smImage: {
    width: 32,
    height: 32,
  },
  mdImage: {
    width: 50,
    height: 50,
  },
  figmaImage: {
    width: 124,
    height: 124,
  },
  lgImage: {
    width: 198,
    height: 198,
  },
});
