import { Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { webTextStyles, webTheme } from "@/theme/webTheme";
import { useAuth } from "@/providers/AuthProvider";

export default function TabsLayout() {
  const auth = useAuth();

  if (auth.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Auth unavailable</Text>
        <Text style={styles.subtitle}>
          {auth.error?.message ?? "Unable to prepare a Supabase session."}
        </Text>
      </View>
    );
  }

  if (auth.status !== "ready" || !auth.session) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#14213d" />
        <Text style={styles.title}>Preparing secure session</Text>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: "center",
        headerStyle: styles.header,
        headerTintColor: webTheme.colors.text,
        headerTitleStyle: styles.headerTitle,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: webTheme.colors.primary,
        tabBarInactiveTintColor: webTheme.colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: styles.scene,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: "Voice",
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: {
    backgroundColor: webTheme.colors.background,
  },
  header: {
    backgroundColor: webTheme.colors.background,
    borderBottomColor: webTheme.colors.border,
  },
  headerTitle: {
    color: webTheme.colors.text,
    fontWeight: "700",
  },
  tabBar: {
    backgroundColor: "#111420",
    borderTopColor: webTheme.colors.border,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "700",
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
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: webTheme.colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
});
