import { Pressable, StyleSheet, Text, View } from "react-native";

type VoiceControlsProps = {
  status: string;
  isRecording: boolean;
  isTeacherActive: boolean;
  onConnect: () => Promise<void> | void;
  onReconnect: () => Promise<void> | void;
  onStartRecording: () => Promise<void> | void;
  onStopRecording: () => Promise<void> | void;
  onInterrupt: () => Promise<void> | void;
  onStartTeacherLesson: () => Promise<void> | void;
  onStopTeacherLesson: () => Promise<void> | void;
};

export function VoiceControls({
  status,
  isRecording,
  isTeacherActive,
  onConnect,
  onReconnect,
  onStartRecording,
  onStopRecording,
  onInterrupt,
  onStartTeacherLesson,
  onStopTeacherLesson,
}: VoiceControlsProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.status}>Voice: {status}</Text>
      <View style={styles.row}>
        <Pressable onPress={() => void onConnect()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Connect</Text>
        </Pressable>
        <Pressable onPress={() => void onReconnect()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Reconnect</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() => void (isRecording ? onStopRecording() : onStartRecording())}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>
            {isRecording ? "Send voice" : "Push to talk"}
          </Text>
        </Pressable>
        <Pressable onPress={() => void onInterrupt()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Interrupt</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() =>
            void (isTeacherActive ? onStopTeacherLesson() : onStartTeacherLesson())
          }
          style={styles.teacherButton}
        >
          <Text style={styles.teacherText}>
            {isTeacherActive ? "Stop lesson" : "Start lesson"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#d0d5dd",
    backgroundColor: "#ffffff",
  },
  status: {
    color: "#475467",
    fontSize: 13,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#101828",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#eef4ff",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryText: {
    color: "#1849a9",
    fontWeight: "700",
    textAlign: "center",
  },
  teacherButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#fff6e6",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  teacherText: {
    color: "#a15c07",
    fontWeight: "700",
    textAlign: "center",
  },
});
