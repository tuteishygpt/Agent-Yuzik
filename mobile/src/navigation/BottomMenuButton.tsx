import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

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
      style={[styles.button, style]}
    >
      <Text style={styles.icon}>☰</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: webTheme.colors.border,
    borderWidth: 1,
  },
  icon: {
    color: webTheme.colors.text,
    fontSize: 24,
    fontWeight: "700",
  },
});
