import { StyleSheet, Text, View } from "react-native";

import { formatSecretState, type PublicEnv } from "@/lib/env";
import { webGlassPanel, webTheme } from "@/theme/webTheme";

type DebugInfoProps = {
  appVersion: string;
  authState: string;
  buildProfile: string;
  env: PublicEnv;
};

type DebugRowProps = {
  label: string;
  value: string;
};

function DebugRow({ label, value }: DebugRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function DebugInfo({
  appVersion,
  authState,
  buildProfile,
  env,
}: DebugInfoProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Build and debug info</Text>

      <DebugRow label="Backend base URL" value={env.backendUrl} />
      <DebugRow label="Supabase project URL" value={env.supabaseUrl} />
      <DebugRow label="Build channel" value={env.buildChannel} />
      <DebugRow label="Build profile" value={buildProfile} />
      <DebugRow label="App version" value={appVersion} />
      <DebugRow label="App scheme" value={env.appScheme} />
      <DebugRow label="Auth state" value={authState} />
      <DebugRow
        label="Supabase anon key"
        value={formatSecretState(env.supabaseAnonKey)}
      />
      <DebugRow
        label="Debug menu"
        value={env.debugMenuEnabled ? "Enabled" : "Disabled"}
      />
      <DebugRow
        label="Network logging"
        value={env.debugNetworkLoggingEnabled ? "Enabled" : "Disabled"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 20,
    borderRadius: webTheme.radii.xl,
    ...webGlassPanel,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: webTheme.colors.text,
    marginBottom: 4,
  },
  row: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: webTheme.colors.textMuted,
  },
  value: {
    fontSize: 16,
    lineHeight: 22,
    color: webTheme.colors.text,
  },
});
