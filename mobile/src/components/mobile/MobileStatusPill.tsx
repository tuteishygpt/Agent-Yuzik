import {
  Animated,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { webTheme } from "@/theme/webTheme";

export type MobileStatusPillTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";

type MobileStatusPillProps = {
  label: string;
  tone?: MobileStatusPillTone;
  animatedDotStyle?: StyleProp<ViewStyle>;
};

const toneColors: Record<MobileStatusPillTone, string> = {
  neutral: webTheme.colors.textDim,
  accent: webTheme.colors.primary,
  success: webTheme.colors.speaking,
  warning: webTheme.colors.processing,
  danger: webTheme.colors.danger,
};

export function MobileStatusPill({
  label,
  tone = "neutral",
  animatedDotStyle,
}: MobileStatusPillProps) {
  const toneColor = toneColors[tone];

  return (
    <View style={[styles.pill, { borderColor: `${toneColor}33` }]}>
      <Animated.View
        style={[styles.dot, { backgroundColor: toneColor }, animatedDotStyle]}
        testID="mobile-status-dot"
      />
      <Text numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: webTheme.radii.pill,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
});
