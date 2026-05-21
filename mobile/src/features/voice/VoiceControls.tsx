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
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
      {onOpenMenu ? (
        <BottomMenuButton onPress={onOpenMenu} />
      ) : null}
      <Pressable
        onPress={handlePress}
        style={[styles.button, isListening ? styles.buttonActive : null]}
        disabled={!connected}
      >
        <Text style={styles.buttonText}>
          {isListening ? "■ Спыніць" : "🎙 Пачаць"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: webTheme.colors.border,
    backgroundColor: "rgba(12, 14, 24, 0.96)",
  },
  button: {
    flex: 1,
    borderRadius: webTheme.radii.pill,
    backgroundColor: webTheme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  buttonActive: {
    backgroundColor: webTheme.colors.listening,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
    textAlign: "center",
  },
});
