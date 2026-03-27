import Constants from "expo-constants";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { DebugInfo } from "@/components/settings/DebugInfo";
import { getRuntimeEnv } from "@/lib/env";
import { useAuth } from "@/providers/AuthProvider";

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
    <ScrollView contentContainerStyle={styles.content}>
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
  content: {
    padding: 20,
    gap: 20,
    backgroundColor: "#f5f7fb",
  },
  hero: {
    paddingTop: 24,
    gap: 6,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#5c677d",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#14213d",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: "#33415c",
  },
});
