import { StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";
import { webGlassPanel, webTheme } from "@/theme/webTheme";

type TeacherBannerProps = {
  lesson: TeacherLesson | null;
  stepPrompt: string | null;
  isActive: boolean;
};

export function TeacherBanner({
  lesson,
  stepPrompt,
  isActive,
}: TeacherBannerProps) {
  const statusLabel = isActive ? "Active" : "Idle";

  return (
    <View style={[styles.card, isActive ? styles.cardActive : null]}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Text style={styles.icon}>📚</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>Настаўнік</Text>
          <Text style={styles.title}>{lesson?.title ?? "No lesson selected"}</Text>
        </View>
        <Text style={[styles.status, isActive ? styles.statusActive : null]}>
          {statusLabel}
        </Text>
      </View>
      <Text style={styles.meta}>
        {lesson ? `${lesson.level} - ${lesson.goal}` : "Choose a lesson to begin."}
      </Text>
      <Text style={styles.prompt}>{stepPrompt ?? "No prompt selected yet."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    gap: 10,
    padding: 16,
    borderRadius: webTheme.radii.lg,
    ...webGlassPanel,
  },
  cardActive: {
    borderColor: "rgba(122, 168, 255, 0.35)",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  iconBox: {
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 10,
    borderColor: webTheme.colors.borderStrong,
    borderWidth: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  icon: {
    fontSize: 18,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: webTheme.colors.textMuted,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: webTheme.colors.text,
  },
  meta: {
    fontSize: 14,
    lineHeight: 20,
    color: webTheme.colors.textMuted,
  },
  status: {
    borderRadius: 6,
    borderColor: webTheme.colors.border,
    borderWidth: 1,
    color: webTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statusActive: {
    color: webTheme.colors.teacher,
    borderColor: "rgba(68, 255, 170, 0.3)",
  },
  prompt: {
    fontSize: 15,
    lineHeight: 22,
    color: webTheme.colors.text,
  },
});

export default TeacherBanner;
