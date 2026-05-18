import Constants from "expo-constants";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { DebugInfo } from "@/components/settings/DebugInfo";
import { useI18n, type Locale } from "@/lib/i18n";
import { getRuntimeEnv } from "@/lib/env";
import { useAuth } from "@/providers/AuthProvider";
import { webTextStyles, webTheme } from "@/theme/webTheme";

function getAuthStateLabel(input: {
  status: "loading" | "ready" | "error";
  isAnonymous: boolean;
  hasSession: boolean;
  t: (key: any) => string;
}): string {
  if (input.status === "loading") return input.t("settings.authLoading");
  if (!input.hasSession) return input.t("settings.signedOut");
  return input.isAnonymous ? input.t("settings.guest") : input.t("settings.email");
}

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "be", label: "Беларуская" },
  { code: "en", label: "English" },
];

export default function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
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
        <Text style={styles.eyebrow}>{t("settings.eyebrow")}</Text>
        <Text style={styles.title}>{t("settings.title")}</Text>
        <Text style={styles.subtitle}>{t("settings.subtitle")}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
        <View style={styles.langRow}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              onPress={() => setLocale(lang.code)}
              style={[styles.langButton, locale === lang.code && styles.langButtonActive]}
            >
              <Text style={[styles.langLabel, locale === lang.code && styles.langLabelActive]}>
                {lang.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <DebugInfo
        appVersion={appVersion}
        authState={getAuthStateLabel({
          status: auth.status,
          isAnonymous: auth.isAnonymous,
          hasSession: Boolean(auth.session),
          t,
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
    backgroundColor: webTheme.colors.bgGlowPrimary,
  },
  bgGlowBottom: {
    position: "absolute",
    right: -90,
    bottom: 70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: webTheme.colors.bgGlowSecondary,
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
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: webTheme.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  langRow: {
    flexDirection: "row",
    gap: 12,
  },
  langButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    flex: 1,
  },
  langButtonActive: {
    borderColor: webTheme.colors.primary,
    backgroundColor: "rgba(100, 149, 237, 0.12)",
  },
  langLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: webTheme.colors.text,
  },
  langLabelActive: {
    color: webTheme.colors.primary,
  },
});
