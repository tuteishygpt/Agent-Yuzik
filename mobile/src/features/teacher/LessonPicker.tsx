import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";
import { webGlassPanel, webTheme } from "@/theme/webTheme";

type LessonPickerProps = {
  lessons: TeacherLesson[];
  selectedLessonId: string | null;
  stepPrompt?: string | null;
  isActive?: boolean;
  onSelectLesson: (lessonId: string) => void;
};

export function LessonPicker({
  lessons,
  selectedLessonId,
  stepPrompt,
  isActive = false,
  onSelectLesson,
}: LessonPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedLesson =
    lessons.find((lesson) => lesson.id === selectedLessonId) ?? null;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.eyebrow}>Teacher lesson</Text>
        <Text style={[styles.status, isActive ? styles.statusActive : null]}>
          {isActive ? "Active" : selectedLesson ? "Ready" : "Choose"}
        </Text>
      </View>
      {lessons.length === 0 ? (
        <Text style={styles.empty}>No lessons loaded yet.</Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((current) => !current)}
            style={({ pressed }) => [
              styles.lessonCard,
              styles.lessonCardSelected,
              pressed ? styles.lessonCardPressed : null,
            ]}
          >
            <Text style={styles.lessonTitle}>
              {selectedLesson?.title ?? "Choose a lesson"}
            </Text>
            <Text style={styles.lessonMeta}>
              {selectedLesson
                ? `${selectedLesson.level} - ${selectedLesson.stepsCount} steps`
                : "Tap to choose"}
            </Text>
            {selectedLesson && stepPrompt ? (
              <Text style={styles.stepPrompt}>{stepPrompt}</Text>
            ) : null}
            <Text style={styles.chevron}>{open ? "▲" : "▼"}</Text>
          </Pressable>

          {open
            ? lessons.map((lesson) => {
                const isSelected = lesson.id === selectedLessonId;

                return (
                  <Pressable
                    key={lesson.id}
                    accessibilityRole="button"
                    onPress={() => {
                      onSelectLesson(lesson.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.lessonCard,
                      isSelected ? styles.optionSelected : null,
                      pressed ? styles.lessonCardPressed : null,
                    ]}
                  >
                    <Text style={styles.lessonTitle}>{lesson.title}</Text>
                    <Text style={styles.lessonMeta}>
                      {lesson.level} - {lesson.stepsCount} steps
                    </Text>
                    <Text style={styles.lessonGoal}>{lesson.goal}</Text>
                    {isSelected ? (
                      <Text style={styles.selectedBadge}>Selected</Text>
                    ) : null}
                  </Pressable>
                );
              })
            : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    gap: 12,
    padding: 14,
    borderRadius: webTheme.radii.lg,
    ...webGlassPanel,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: webTheme.colors.textMuted,
  },
  status: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  statusActive: {
    color: webTheme.colors.teacher,
  },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: webTheme.colors.textMuted,
  },
  lessonCard: {
    gap: 4,
    paddingVertical: 4,
    paddingRight: 30,
  },
  lessonCardSelected: {
    borderColor: "rgba(122, 168, 255, 0.48)",
    backgroundColor: "rgba(78, 130, 238, 0.14)",
  },
  optionSelected: {
    borderColor: "rgba(68, 255, 170, 0.36)",
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
  stepPrompt: {
    fontSize: 14,
    lineHeight: 19,
    color: webTheme.colors.text,
  },
  selectedBadge: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: webTheme.colors.teacher,
  },
  chevron: {
    position: "absolute",
    right: 16,
    top: 18,
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
});

export default LessonPicker;
