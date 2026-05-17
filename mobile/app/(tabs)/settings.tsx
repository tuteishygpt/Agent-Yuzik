import Constants from "expo-constants";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { DebugInfo } from "@/components/settings/DebugInfo";
import { getRuntimeEnv } from "@/lib/env";
import { useAuth } from "@/providers/AuthProvider";
import { webTextStyles, webTheme } from "@/theme/webTheme";

function getAuthStateLabel(input: {
  status: "loading" | "ready" | "error";
  isAnonymous: boolean;
  hasSession: boolean;
}): string {
  if (input.status === "loading") {
    return "Loading auth";
  }

  if (!input.hasSession) {
    return "Signed out";
  }

  return input.isAnonymous ? "Guest session" : "Email account";
}

export default function SettingsScreen() {
  const expoConfig = Constants.expoConfig;
  const env = getRuntimeEnv();
  const auth = useAuth();
  const buildProfile =
    String(expoConfig?.extra?.buildProfile ?? "").trim() || "development";
  const appVersion = String(expoConfig?.version ?? "1.0.0");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Runtime</Text>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Environment and build diagnostics for the Expo shell.
        </Text>
      </View>

      <DebugInfo
        appVersion={appVersion}
        authState={getAuthStateLabel({
          status: auth.status,
          isAnonymous: auth.isAnonymous,
          hasSession: Boolean(auth.session),
        })}
        buildProfile={buildProfile}
        env={env}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: webTheme.colors.background,
  },
  content: {
    padding: 20,
    gap: 20,
    minHeight: "100%",
  },
  bgGlowTop: {
    position: "absolute",
    top: -80,
    left: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(78, 130, 238, 0.13)",
  },
  bgGlowBottom: {
    position: "absolute",
    right: -90,
    bottom: 70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(130, 78, 238, 0.11)",
  },
  hero: {
    paddingTop: 24,
    gap: 6,
  },
  eyebrow: {
    ...webTextStyles.eyebrow,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: webTheme.colors.text,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: webTheme.colors.textMuted,
  },
});
