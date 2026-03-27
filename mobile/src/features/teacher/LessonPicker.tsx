import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";

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
    gap: 12,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#5c677d",
  },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: "#33415c",
  },
  lessonCard: {
    gap: 4,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d9e2ec",
  },
  lessonCardSelected: {
    borderColor: "#fca311",
    backgroundColor: "#fff6e6",
  },
  lessonCardPressed: {
    opacity: 0.85,
  },
  lessonTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#14213d",
  },
  lessonMeta: {
    fontSize: 13,
    color: "#5c677d",
  },
  lessonGoal: {
    fontSize: 14,
    lineHeight: 20,
    color: "#33415c",
  },
  selectedBadge: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#f77f00",
  },
});

export default LessonPicker;
