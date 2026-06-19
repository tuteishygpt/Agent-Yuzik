import { StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";
import { webTheme } from "@/theme/webTheme";

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
  const statusLabel = isActive ? "Актыўна" : "Чакае";

  return (
    <View style={[styles.card, isActive ? styles.cardActive : null]}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>Настаўнік</Text>
          <Text numberOfLines={1} style={styles.title}>
            {lesson?.title ?? "Занятак не абраны"}
          </Text>
        </View>
        <Text style={[styles.status, isActive ? styles.statusActive : null]}>
          {statusLabel}
        </Text>
      </View>
      <Text style={styles.meta}>
        {lesson ? `${lesson.level} - ${lesson.goal}` : "Абярыце занятак, каб пачаць."}
      </Text>
      <Text style={styles.prompt}>{stepPrompt ?? "Падказка яшчэ не абрана."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    gap: 10,
    padding: 14,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  cardActive: {
    borderColor: webTheme.colors.teacher,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: webTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  meta: {
    color: webTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  status: {
    borderRadius: webTheme.radii.sm,
    borderColor: webTheme.colors.border,
    borderWidth: 1,
    color: webTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
  statusActive: {
    color: webTheme.colors.teacher,
    borderColor: webTheme.colors.teacher,
  },
  prompt: {
    color: webTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});

export default TeacherBanner;
