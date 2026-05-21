import { useState } from "react";
import { Tabs, useRouter, useSegments } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useI18n } from "@/lib/i18n";
import { MenuProvider } from "@/navigation/MenuContext";
import { webTextStyles, webTheme } from "@/theme/webTheme";
import { useAuth } from "@/providers/AuthProvider";

const MENU_ITEMS = [
  { route: "voice", icon: "🎤", key: "tab.voice" },
  { route: "chat", icon: "💬", key: "tab.chat" },
  { route: "settings", icon: "⚙️", key: "tab.settings" },
] as const;

export default function TabsLayout() {
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const segments = useSegments();
  const [menuOpen, setMenuOpen] = useState(false);

  const currentRoute = segments[segments.length - 1] ?? "voice";
  if (auth.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>{t("auth.unavailable")}</Text>
        <Text style={styles.subtitle}>
          {auth.error?.message ?? t("auth.errorDefault")}
        </Text>
      </View>
    );
  }

  if (auth.status !== "ready" || !auth.session) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={webTheme.colors.primary} />
        <Text style={styles.title}>{t("auth.preparing")}</Text>
      </View>
    );
  }

  return (
    <MenuProvider value={{ openMenu: () => setMenuOpen(true) }}>
      <View style={styles.root}>
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menu}>
              {MENU_ITEMS.map((item) => (
                <Pressable
                  key={item.route}
                  style={[
                    styles.menuItem,
                    currentRoute === item.route && styles.menuItemActive,
                  ]}
                  onPress={() => {
                    setMenuOpen(false);
                    router.replace(`/(tabs)/${item.route}` as any);
                  }}
                >
                  <Text style={styles.menuIcon}>{item.icon}</Text>
                  <Text
                    style={[
                      styles.menuLabel,
                      currentRoute === item.route && styles.menuLabelActive,
                    ]}
                  >
                    {t(item.key as any)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: "none" },
            sceneStyle: styles.scene,
          }}
        >
          <Tabs.Screen name="chat" />
          <Tabs.Screen name="voice" />
          <Tabs.Screen name="settings" />
        </Tabs>
      </View>
    </MenuProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: webTheme.colors.background,
  },
  scene: {
    backgroundColor: webTheme.colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 44,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(12, 14, 24, 0.96)",
    borderBottomWidth: 1,
    borderBottomColor: webTheme.colors.border,
  },
  hamburger: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  hamburgerIcon: {
    fontSize: 22,
    color: webTheme.colors.text,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: webTheme.colors.text,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  menu: {
    position: "absolute",
    bottom: 96,
    left: 16,
    backgroundColor: "rgba(22, 24, 40, 0.98)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    padding: 8,
    minWidth: 200,
    gap: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  menuItemActive: {
    backgroundColor: "rgba(100, 149, 237, 0.15)",
  },
  menuIcon: {
    fontSize: 18,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: webTheme.colors.text,
  },
  menuLabelActive: {
    color: webTheme.colors.primary,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: webTheme.colors.background,
  },
  title: {
    ...webTextStyles.title,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: webTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
