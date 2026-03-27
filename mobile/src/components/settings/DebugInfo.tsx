import { StyleSheet, Text, View } from "react-native";

import { formatSecretState, type PublicEnv } from "@/lib/env";

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
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe2ef",
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#14213d",
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
    color: "#5c677d",
  },
  value: {
    fontSize: 16,
    lineHeight: 22,
    color: "#1f2937",
  },
});
