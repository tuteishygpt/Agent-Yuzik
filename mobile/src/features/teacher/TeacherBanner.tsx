import { StyleSheet, Text, View } from "react-native";

import type { TeacherLesson } from "@/features/teacher/teacher-types";

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
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Teacher mode</Text>
      <Text style={styles.title}>{lesson?.title ?? "No lesson selected"}</Text>
      <Text style={styles.meta}>
        {lesson ? `${lesson.level} - ${lesson.goal}` : "Choose a lesson to begin."}
      </Text>
      <Text style={styles.status}>{statusLabel}</Text>
      <Text style={styles.prompt}>{stepPrompt ?? "No prompt selected yet."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "#14213d",
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#9db4d6",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#f8f9fa",
  },
  meta: {
    fontSize: 14,
    lineHeight: 20,
    color: "#dbe4f0",
  },
  status: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fca311",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  prompt: {
    fontSize: 15,
    lineHeight: 22,
    color: "#ffffff",
  },
});

export default TeacherBanner;
