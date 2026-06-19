import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { webTheme } from "@/theme/webTheme";

export type MobileActionButtonVariant = "primary" | "secondary" | "ghost";

type MobileActionButtonProps = {
  label: string;
  icon?: ReactNode;
  variant?: MobileActionButtonVariant;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function MobileActionButton({
  label,
  icon,
  variant = "secondary",
  disabled = false,
  onPress,
  accessibilityLabel,
  style,
}: MobileActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {typeof icon === "string" ? <Text style={styles.icon}>{icon}</Text> : icon}
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          variant === "primary" ? styles.primaryLabel : null,
          disabled ? styles.disabledLabel : null,
        ]}
      >
        {label}
      </Text>
      <View style={styles.stabilizer} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: webTheme.radii.md,
    borderWidth: 1,
  },
  primary: {
    backgroundColor: webTheme.colors.primary,
    borderColor: webTheme.colors.primary,
  },
  secondary: {
    backgroundColor: webTheme.colors.surface,
    borderColor: webTheme.colors.border,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.45,
  },
  icon: {
    color: webTheme.colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  label: {
    color: webTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  primaryLabel: {
    color: webTheme.colors.surface,
  },
  disabledLabel: {
    color: webTheme.colors.textDim,
  },
  stabilizer: {
    width: 0,
    height: 0,
  },
});
