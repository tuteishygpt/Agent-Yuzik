import { Stack } from "expo-router";

import { AuthProvider } from "@/providers/AuthProvider";
import { I18nProvider } from "@/lib/i18n";
import { VoiceSettingsProvider } from "@/providers/VoiceSettingsProvider";

export default function RootLayout() {
  return (
    <I18nProvider>
      <VoiceSettingsProvider>
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth/callback" />
          </Stack>
        </AuthProvider>
      </VoiceSettingsProvider>
    </I18nProvider>
  );
}
