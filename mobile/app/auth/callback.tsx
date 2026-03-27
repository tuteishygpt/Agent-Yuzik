import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

import { completeSupabaseNativeCallback } from "@/lib/supabase";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (url) {
          setErrorMessage(null);
          await completeSupabaseNativeCallback(url);

          if (!cancelled) {
            router.replace("/(tabs)");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "The auth callback could not be completed.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, url]);

  return (
    <View style={styles.container}>
      {errorMessage ? null : <ActivityIndicator size="large" color="#14213d" />}
      <Text style={styles.title}>
        {errorMessage ? "Sign in couldn't be completed" : "Completing sign in"}
      </Text>
      <Text style={styles.subtitle}>
        {errorMessage ?? "Finalizing your session and returning to Yuzik."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: 24,
    backgroundColor: "#f5f7fb",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#14213d",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    color: "#33415c",
  },
});
