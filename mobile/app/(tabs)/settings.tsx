import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { MobileScreenShell } from "@/components/mobile";
import { useI18n, type Locale } from "@/lib/i18n";
import { useMenu } from "@/navigation/MenuContext";
import { useVoiceSettings } from "@/providers/VoiceSettingsProvider";
import { webTheme } from "@/theme/webTheme";

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "be", label: "Беларуская" },
  { code: "en", label: "English" },
];

export default function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const { openMenu } = useMenu();
  const { preferNativeTenVad, setPreferNativeTenVad } = useVoiceSettings();

  return (
    <MobileScreenShell
      contentStyle={styles.shellContent}
      onOpenMenu={openMenu}
      title={t("settings.title")}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings.language")}</Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((lang) => (
              <Pressable
                key={lang.code}
                onPress={() => setLocale(lang.code)}
                style={[
                  styles.langButton,
                  locale === lang.code ? styles.langButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.langLabel,
                    locale === lang.code ? styles.langLabelActive : null,
                  ]}
                >
                  {lang.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings.voice")}</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingLabel}>{t("settings.nativeTenVad")}</Text>
              <Text style={styles.settingDescription}>
                {t("settings.nativeTenVadDescription")}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t("settings.nativeTenVad")}
              onValueChange={setPreferNativeTenVad}
              thumbColor={
                preferNativeTenVad ? webTheme.colors.primary : webTheme.colors.surface
              }
              trackColor={{
                false: webTheme.colors.surfaceMuted,
                true: webTheme.colors.primaryGlow,
              }}
              value={preferNativeTenVad}
            />
          </View>
        </View>
      </ScrollView>

    </MobileScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  content: {
    gap: 20,
    minHeight: "100%",
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 112,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: webTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  langRow: {
    flexDirection: "row",
    gap: 10,
  },
  langButton: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    paddingHorizontal: 12,
  },
  langButtonActive: {
    borderColor: webTheme.colors.primary,
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  langLabel: {
    color: webTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  langLabelActive: {
    color: webTheme.colors.primary,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: 14,
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  settingCopy: {
    flex: 1,
    gap: 5,
  },
  settingLabel: {
    color: webTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  settingDescription: {
    color: webTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});
