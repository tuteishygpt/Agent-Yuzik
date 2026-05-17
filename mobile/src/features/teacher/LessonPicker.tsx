import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";
import { webGlassPanel, webTheme } from "@/theme/webTheme";

type LessonPickerProps = {
  lessons: TeacherLesson[];
  selectedLessonId: string | null;
  onSelectLesson: (lessonId: string) => void;
};

export function LessonPicker({
  lessons,
  selectedLessonId,
  onSelectLesson,
}: LessonPickerProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Lesson catalog</Text>
      {lessons.length === 0 ? (
        <Text style={styles.empty}>No lessons loaded yet.</Text>
      ) : (
        lessons.map((lesson) => {
          const isSelected = lesson.id === selectedLessonId;

          return (
            <Pressable
              key={lesson.id}
              accessibilityRole="button"
              onPress={() => onSelectLesson(lesson.id)}
              style={({ pressed }) => [
                styles.lessonCard,
                isSelected ? styles.lessonCardSelected : null,
                pressed ? styles.lessonCardPressed : null,
              ]}
            >
              <Text style={styles.lessonTitle}>{lesson.title}</Text>
              <Text style={styles.lessonMeta}>
                {lesson.level} - {lesson.stepsCount} steps
              </Text>
              <Text style={styles.lessonGoal}>{lesson.goal}</Text>
              {isSelected ? <Text style={styles.selectedBadge}>Selected</Text> : null}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 12,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: webTheme.colors.textMuted,
  },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: webTheme.colors.textMuted,
  },
  lessonCard: {
    gap: 4,
    padding: 16,
    borderRadius: webTheme.radii.lg,
    ...webGlassPanel,
  },
  lessonCardSelected: {
    borderColor: "rgba(122, 168, 255, 0.48)",
    backgroundColor: "rgba(78, 130, 238, 0.14)",
  },
  lessonCardPressed: {
    opacity: 0.85,
  },
  lessonTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: webTheme.colors.text,
  },
  lessonMeta: {
    fontSize: 13,
    color: webTheme.colors.textMuted,
  },
  lessonGoal: {
    fontSize: 14,
    lineHeight: 20,
    color: webTheme.colors.textMuted,
  },
  selectedBadge: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: webTheme.colors.teacher,
  },
});

export default LessonPicker;
