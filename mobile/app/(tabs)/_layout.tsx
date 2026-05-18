import { Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";
import { webTextStyles, webTheme } from "@/theme/webTheme";
import { useAuth } from "@/providers/AuthProvider";

function TabIcon({ icon, color, focused }: { icon: string; color: string; focused: boolean }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Text style={[styles.icon, { color }]}>{icon}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const auth = useAuth();
  const { t } = useI18n();

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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: webTheme.colors.primary,
        tabBarInactiveTintColor: webTheme.colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        sceneStyle: styles.scene,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: t("tab.chat"),
          tabBarIcon: ({ color, focused }) => <TabIcon icon="💬" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: t("tab.voice"),
          tabBarIcon: ({ color, focused }) => <TabIcon icon="🎤" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tab.settings"),
          tabBarIcon: ({ color, focused }) => <TabIcon icon="⚙️" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: {
    backgroundColor: webTheme.colors.background,
  },
  tabBar: {
    backgroundColor: "rgba(20, 20, 35, 0.95)",
    borderTopColor: webTheme.colors.border,
    borderTopWidth: 1,
    height: 72,
    paddingTop: 8,
    paddingBottom: 10,
  },
  tabItem: {
    gap: 4,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  iconWrap: {
    width: 42,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: "rgba(100, 149, 237, 0.15)",
  },
  icon: {
    fontSize: 20,
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
