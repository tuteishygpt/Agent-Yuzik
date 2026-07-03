import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "@/lib/i18n";
import { BottomMenuButton } from "@/navigation/BottomMenuButton";
import { webTheme } from "@/theme/webTheme";

import type { VoiceUiState } from "./voice-ui-state";

type VoiceControlsProps = {
  status: string;
  isListening: boolean;
  inputLevel?: number;
  uiState?: VoiceUiState;
  visualizerPulse?: Animated.Value;
  onOpenMenu?: () => void;
  onStartListening: () => Promise<void> | void;
  onStopListening: () => void;
  onInterrupt: () => Promise<void> | void;
};

const waveformBars = [
  5, 9, 13, 18, 24, 16, 10, 7, 13, 21, 27, 19, 11, 6, 10, 17, 23, 15, 8, 5, 9,
  14, 20, 13, 7,
];

export function VoiceControls({
  status,
  isListening,
  inputLevel,
  uiState,
  visualizerPulse,
  onOpenMenu,
  onStartListening,
  onStopListening,
  onInterrupt,
}: VoiceControlsProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const unavailable = status === "connecting" || status === "reconnecting";

  function handlePress() {
    if (isListening) {
      onStopListening();
      void onInterrupt();
    } else {
      void onStartListening();
    }
  }

  function handleConfirm() {
    onStopListening();
  }

  function handleDiscard() {
    onStopListening();
    void onInterrupt();
  }

  const waveformColor = uiState?.accentColor ?? webTheme.colors.surfaceMuted;
  const clampedInputLevel =
    typeof inputLevel === "number" && Number.isFinite(inputLevel)
      ? Math.max(0, Math.min(1, inputLevel))
      : null;
  const shouldAnimateWaveform = Boolean(
    clampedInputLevel == null &&
    uiState?.shouldAnimateVisualizer &&
    visualizerPulse,
  );

  if (isListening) {
    return (
      <View
        style={[
          styles.container,
          styles.listeningContainer,
          { paddingBottom: Math.max(insets.bottom, 12) + 8 },
        ]}
      >
        <View style={styles.inputBar} testID="voice-listening-input">
          {waveformBars.map((height, index) => {
            const pulseOffset = (index % 6) / 6;
            const animatedHeight =
              clampedInputLevel != null
                ? Math.max(
                    5,
                    Math.min(
                      38,
                      height *
                        (0.55 +
                          clampedInputLevel * (0.95 + pulseOffset * 0.35)),
                    ),
                  )
                : shouldAnimateWaveform && visualizerPulse
                  ? visualizerPulse.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [
                        height,
                        height + 10 + pulseOffset * 12,
                        height,
                      ],
                    })
                  : height;

            return (
              <Animated.View
                key={`${height}-${index}`}
                testID="voice-listening-waveform-bar"
                style={[
                  styles.waveformBar,
                  {
                    backgroundColor: waveformColor,
                    height: animatedHeight,
                    opacity:
                      clampedInputLevel != null || shouldAnimateWaveform
                        ? 0.84
                        : 0.36,
                  },
                ]}
              />
            );
          })}
        </View>
        <Pressable
          accessibilityLabel="Confirm transcript"
          onPress={handleConfirm}
          style={styles.roundButton}
        >
          <Text style={styles.roundButtonText}>✓</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Discard transcript"
          onPress={handleDiscard}
          style={styles.roundButton}
        >
          <Text style={styles.roundButtonText}>×</Text>
        </Pressable>
      </View>
    );
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
        disabled={unavailable}
        onPress={handlePress}
        style={[
          styles.button,
          isListening ? styles.buttonActive : null,
          unavailable ? styles.buttonDisabled : null,
        ]}
      >
        <Text style={styles.buttonText}>
          {isListening ? t("voice.stop") : t("voice.start")}
        </Text>
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
    paddingTop: 8,
    backgroundColor: webTheme.colors.background,
  },
  button: {
    flex: 1,
    height: webTheme.sizes.ctaHeight,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: webTheme.radii.cta,
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
    color: webTheme.colors.primarySoft,
    fontSize: 16,
    fontWeight: "400",
    textAlign: "center",
  },
  listeningContainer: {
    gap: 8,
  },
  inputBar: {
    flex: 1,
    height: webTheme.sizes.inputHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
    paddingHorizontal: 12,
    borderRadius: webTheme.radii.textBar,
    backgroundColor: webTheme.colors.surface,
    borderColor: webTheme.colors.borderStrong,
    borderWidth: 1,
    overflow: "hidden",
  },
  waveformBar: {
    flex: 1,
    minWidth: 2,
    borderRadius: 2,
    backgroundColor: webTheme.colors.surfaceMuted,
  },
  roundButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: webTheme.colors.surface,
    borderColor: webTheme.colors.borderStrong,
    borderWidth: 1,
  },
  roundButtonText: {
    color: webTheme.colors.text,
    fontSize: 20,
    fontWeight: "500",
    lineHeight: 22,
  },
});
