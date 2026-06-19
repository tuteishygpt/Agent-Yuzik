import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { webTheme } from "@/theme/webTheme";

type BottomMenuButtonProps = {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function BottomMenuButton({ onPress, style }: BottomMenuButtonProps) {
  return (
    <Pressable
      accessibilityLabel="Open menu"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed ? styles.buttonPressed : null,
        style,
      ]}
    >
      <View style={styles.line} />
      <View style={styles.line} />
      <View style={styles.line} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surface,
    borderColor: webTheme.colors.border,
    borderWidth: 1,
  },
  buttonPressed: {
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  line: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: webTheme.colors.text,
  },
});
