import { useState } from "react";
import { Tabs, useRouter, useSegments } from "expo-router";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { MobileMenu, type MobileMenuItem } from "@/components/mobile";
import { useI18n } from "@/lib/i18n";
import { MenuProvider } from "@/navigation/MenuContext";
import { useAuth } from "@/providers/AuthProvider";
import { webTextStyles, webTheme } from "@/theme/webTheme";

const MENU_ITEMS = [
  { route: "voice", key: "tab.voice", description: "Жывая размова з Юзікам" },
  { route: "teacher", key: "tab.teacher", description: "Практыка па кроках" },
  { route: "chat", key: "tab.chat", description: "Пісьмовы дыялог і файлы" },
  { route: "settings", key: "tab.settings", description: "Мова, голас і дыягностыка" },
] as const;

type MenuRoute = (typeof MENU_ITEMS)[number]["route"];

export default function TabsLayout() {
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const segments = useSegments();
  const [menuOpen, setMenuOpen] = useState(false);

  const currentRoute = (segments[segments.length - 1] ?? "voice") as MenuRoute;

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
        <ActivityIndicator color={webTheme.colors.primary} size="large" />
        <Text style={styles.title}>{t("auth.preparing")}</Text>
      </View>
    );
  }

  const menuItems: MobileMenuItem<MenuRoute>[] = MENU_ITEMS.map((item) => ({
    route: item.route,
    label: t(item.key as any),
    description: item.description,
  }));

  return (
    <MenuProvider value={{ openMenu: () => setMenuOpen(true) }}>
      <View style={styles.root}>
        <Modal
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
          transparent
          visible={menuOpen}
        >
          <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuWrap}>
              <MobileMenu
                activeRoute={currentRoute}
                items={menuItems}
                onSelect={(route) => {
                  setMenuOpen(false);
                  router.replace(`/(tabs)/${route}` as any);
                }}
                title="Навігацыя"
              />
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
          <Tabs.Screen name="teacher" />
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
  overlay: {
    flex: 1,
    backgroundColor: "rgba(31, 29, 27, 0.28)",
    justifyContent: "flex-end",
  },
  menuWrap: {
    paddingHorizontal: 16,
    paddingBottom: 104,
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
