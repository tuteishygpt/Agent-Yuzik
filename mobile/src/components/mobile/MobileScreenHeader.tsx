import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { webTheme } from "@/theme/webTheme";

type MobileScreenHeaderProps = {
  title: string;
  onOpenMenu: () => void;
  accessibilityLabel?: string;
  rightAccessory?: ReactNode;
  testID?: string;
};

export function MobileScreenHeader({
  title,
  onOpenMenu,
  accessibilityLabel,
  rightAccessory,
  testID = "mobile-screen-header",
}: MobileScreenHeaderProps) {
  return (
    <View style={styles.header} testID={testID}>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? `Open ${title} menu`}
        accessibilityRole="button"
        onPress={onOpenMenu}
        style={styles.menuButton}
      >
        <View style={styles.icon} testID="mobile-screen-header-menu-icon">
          <View style={styles.line} />
          <View style={styles.line} />
          <View style={styles.line} />
        </View>
        <Text numberOfLines={1} style={styles.title} testID="mobile-screen-header-title">
          {title}
        </Text>
      </Pressable>
      {rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuButton: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    width: webTheme.sizes.icon,
    height: webTheme.sizes.icon,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  line: {
    width: 16,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.primary,
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
  },
  right: {
    marginLeft: 16,
  },
});
