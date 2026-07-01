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
  title = "Меню",
}: MobileMenuProps<Route>) {
  return (
    <View style={styles.menu}>
      <View style={styles.header}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
      </View>
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
    gap: 6,
    padding: 10,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  header: {
    alignItems: "center",
    gap: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: webTheme.colors.borderStrong,
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  row: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: webTheme.radii.md,
  },
  rowActive: {
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  indicator: {
    width: 4,
    height: 26,
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
    fontSize: 15,
    fontWeight: "700",
  },
  labelActive: {
    color: webTheme.colors.primary,
  },
  description: {
    marginTop: 2,
    color: webTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
