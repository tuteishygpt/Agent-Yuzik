import { Pressable, StyleSheet, Text, View } from "react-native";

import { webTheme } from "@/theme/webTheme";

export type MobileMenuItem<Route extends string = string> = {
  label: string;
  route: Route;
  description?: string;
};

type MobileMenuProps<Route extends string = string> = {
  items: MobileMenuItem<Route>[];
  activeRoute?: Route;
  onSelect: (route: Route) => void;
  title?: string;
};

export function MobileMenu<Route extends string = string>({
  items,
  activeRoute,
  onSelect,
  title: _title,
}: MobileMenuProps<Route>) {
  return (
    <View style={styles.menu} testID="mobile-menu">
      {items.map((item) => {
        const isActive = item.route === activeRoute;

        return (
          <Pressable
            accessibilityLabel={`Open ${item.label}`}
            accessibilityRole="button"
            key={item.route}
            onPress={() => onSelect(item.route)}
            style={({ pressed }) => [
              styles.row,
              isActive || pressed ? styles.rowHighlighted : null,
            ]}
          >
            <View style={styles.iconSlot} />
            <View style={styles.copy}>
              <Text style={styles.label} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    width: webTheme.sizes.menuWidth,
    gap: 6,
    padding: webTheme.spacing.lg,
    borderRadius: webTheme.radii.basic,
    backgroundColor: webTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  row: {
    height: webTheme.sizes.menuRowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: webTheme.spacing.sm,
    paddingLeft: 7,
    paddingRight: 20,
    paddingVertical: 8,
    borderRadius: webTheme.radii.sm,
  },
  rowHighlighted: {
    backgroundColor: webTheme.colors.primarySoft,
  },
  iconSlot: {
    width: webTheme.sizes.icon,
    height: webTheme.sizes.icon,
    borderRadius: webTheme.radii.sm,
    borderWidth: 1,
    borderColor: webTheme.colors.textMuted,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    color: webTheme.colors.text,
    fontSize: 16,
    fontWeight: "400",
  },
});
