import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomMenuButton } from "@/navigation/BottomMenuButton";
import { webTheme } from "@/theme/webTheme";

type VoiceControlsProps = {
  status: string;
  isListening: boolean;
  onOpenMenu?: () => void;
  onStartListening: () => Promise<void> | void;
  onStopListening: () => void;
  onInterrupt: () => Promise<void> | void;
};

export function VoiceControls({
  status,
  isListening,
  onOpenMenu,
  onStartListening,
  onStopListening,
  onInterrupt,
}: VoiceControlsProps) {
  const insets = useSafeAreaInsets();
  const connected = status === "connected" || status === "processing" || isListening;

  function handlePress() {
    if (isListening) {
      onStopListening();
      void onInterrupt();
    } else {
      void onStartListening();
    }
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 12) + 8 },
      ]}
    >
      {onOpenMenu ? <BottomMenuButton onPress={onOpenMenu} /> : null}
      <Pressable
        accessibilityLabel={isListening ? "Stop listening" : "Start listening"}
        disabled={!connected}
        onPress={handlePress}
        style={[
          styles.button,
          isListening ? styles.buttonActive : null,
          !connected ? styles.buttonDisabled : null,
        ]}
      >
        <Text style={styles.buttonText}>{isListening ? "Stop" : "Start"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: webTheme.colors.border,
    backgroundColor: webTheme.colors.background,
  },
  button: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.radii.lg,
    backgroundColor: webTheme.colors.primary,
    paddingHorizontal: 16,
  },
  buttonActive: {
    backgroundColor: webTheme.colors.text,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: webTheme.colors.surface,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
});
