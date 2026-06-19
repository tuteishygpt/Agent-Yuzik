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
};

export function MobileMenu<Route extends string = string>({
  items,
  activeRoute,
  onSelect,
}: MobileMenuProps<Route>) {
  return (
    <View style={styles.menu}>
      {items.map((item) => {
        const isActive = item.route === activeRoute;

        return (
          <Pressable
            accessibilityLabel={`Open ${item.label}`}
            accessibilityRole="button"
            key={item.route}
            onPress={() => onSelect(item.route)}
            style={[styles.row, isActive ? styles.rowActive : null]}
          >
            <View
              style={[styles.indicator, isActive ? styles.indicatorActive : null]}
              testID={isActive ? "mobile-menu-active-indicator" : undefined}
            />
            <View style={styles.copy}>
              <Text style={[styles.label, isActive ? styles.labelActive : null]}>
                {item.label}
              </Text>
              {item.description ? (
                <Text numberOfLines={1} style={styles.description}>
                  {item.description}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    gap: 8,
    padding: 8,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: webTheme.radii.md,
  },
  rowActive: {
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  indicator: {
    width: 4,
    height: 28,
    borderRadius: 2,
    backgroundColor: webTheme.colors.border,
  },
  indicatorActive: {
    backgroundColor: webTheme.colors.primary,
  },
  copy: {
    flex: 1,
  },
  label: {
    color: webTheme.colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  labelActive: {
    color: webTheme.colors.primary,
  },
  description: {
    marginTop: 2,
    color: webTheme.colors.textMuted,
    fontSize: 12,
  },
});
