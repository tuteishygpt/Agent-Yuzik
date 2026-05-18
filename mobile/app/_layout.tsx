import { Stack } from "expo-router";

import { AuthProvider } from "@/providers/AuthProvider";
import { I18nProvider } from "@/lib/i18n";

export default function RootLayout() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth/callback" />
        </Stack>
      </AuthProvider>
    </I18nProvider>
  );
}
