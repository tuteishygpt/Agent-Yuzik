import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";
import { webTheme } from "@/theme/webTheme";

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

  if (isActive && selectedLesson) {
    return (
      <View style={[styles.panel, styles.activePanel]}>
        <View style={styles.activeCopy}>
          <Text numberOfLines={1} style={styles.activeTitle}>
            {selectedLesson.title}
          </Text>
          <Text numberOfLines={1} style={styles.activeMeta}>
            {selectedLesson.level} - {selectedLesson.stepsCount} steps
          </Text>
        </View>
        <Text style={styles.activeBadge}>Active</Text>
      </View>
    );
  }

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
              styles.selectedRow,
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={styles.selectedCopy}>
              <Text numberOfLines={1} style={styles.lessonTitle}>
                {selectedLesson?.title ?? "Choose a lesson"}
              </Text>
              <Text numberOfLines={1} style={styles.lessonMeta}>
                {selectedLesson
                  ? `${selectedLesson.level} - ${selectedLesson.stepsCount} steps`
                  : "Tap to choose"}
              </Text>
              {selectedLesson && stepPrompt ? (
                <Text numberOfLines={2} style={styles.stepPrompt}>
                  {stepPrompt}
                </Text>
              ) : null}
            </View>
            <Text style={styles.chevron}>{open ? "^" : "v"}</Text>
          </Pressable>

          {open ? (
            <View style={styles.optionList}>
              {lessons.map((lesson) => {
                const isSelected = lesson.id === selectedLessonId;

                return (
                  <Pressable
                    accessibilityRole="button"
                    key={lesson.id}
                    onPress={() => {
                      onSelectLesson(lesson.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected ? styles.optionSelected : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <View style={styles.selectedCopy}>
                      <Text numberOfLines={1} style={styles.lessonTitle}>
                        {lesson.title}
                      </Text>
                      <Text style={styles.lessonMeta}>
                        {lesson.level} - {lesson.stepsCount} steps
                      </Text>
                      <Text numberOfLines={2} style={styles.lessonGoal}>
                        {lesson.goal}
                      </Text>
                    </View>
                    {isSelected ? <Text style={styles.selectedBadge}>Selected</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    gap: 10,
    padding: 12,
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  activePanel: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  activeCopy: {
    flex: 1,
    gap: 2,
  },
  activeTitle: {
    color: webTheme.colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  activeMeta: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  activeBadge: {
    color: webTheme.colors.teacher,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
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
    color: webTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  selectedRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  selectedCopy: {
    flex: 1,
    gap: 3,
  },
  pressed: {
    opacity: 0.82,
  },
  lessonTitle: {
    color: webTheme.colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  lessonMeta: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  lessonGoal: {
    color: webTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  stepPrompt: {
    color: webTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    color: webTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: "800",
  },
  optionList: {
    gap: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: webTheme.radii.md,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  optionSelected: {
    borderColor: webTheme.colors.teacher,
    backgroundColor: webTheme.colors.surfaceStrong,
  },
  selectedBadge: {
    color: webTheme.colors.teacher,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
});

export default LessonPicker;
