import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n, type Locale } from "@/lib/i18n";
import { BottomMenuButton } from "@/navigation/BottomMenuButton";
import { useMenu } from "@/navigation/MenuContext";
import { useVoiceSettings } from "@/providers/VoiceSettingsProvider";
import { webTextStyles, webTheme } from "@/theme/webTheme";

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "be", label: "Беларуская" },
  { code: "en", label: "English" },
];

export default function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const { openMenu } = useMenu();
  const { preferNativeTenVad, setPreferNativeTenVad } = useVoiceSettings();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
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
              value={preferNativeTenVad}
              onValueChange={setPreferNativeTenVad}
              trackColor={{
                false: "rgba(148, 163, 184, 0.36)",
                true: "rgba(100, 149, 237, 0.48)",
              }}
              thumbColor={preferNativeTenVad ? webTheme.colors.primary : "#f8fafc"}
            />
          </View>
        </View>
      </ScrollView>
      <View style={[styles.bottomMenu, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <BottomMenuButton onPress={openMenu} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: webTheme.colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 112,
    gap: 20,
    minHeight: "100%",
  },
  bottomMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: webTheme.colors.border,
    backgroundColor: "rgba(12, 14, 24, 0.96)",
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
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  settingCopy: {
    flex: 1,
    gap: 6,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: webTheme.colors.text,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: webTheme.colors.textMuted,
  },
});
