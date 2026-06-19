import { Animated, StyleSheet, View } from "react-native";

import type { VoiceUiState } from "@/features/voice/voice-ui-state";
import { webTheme } from "@/theme/webTheme";

const VISUALIZER_BAR_COUNT = 24;
const visualizerHeights = Array.from(
  { length: VISUALIZER_BAR_COUNT },
  (_, i) => 12 + ((i * 11) % 52),
);

type VoiceVisualizerProps = {
  pulse: Animated.Value;
  uiState: VoiceUiState;
};

export function VoiceVisualizer({ pulse, uiState }: VoiceVisualizerProps) {
  return (
    <View
      style={[
        styles.visualizer,
        uiState.phase === "processing" ? styles.processing : null,
      ]}
    >
      {visualizerHeights.map((height, index) => {
        const pulseOffset = (index % 6) / 6;
        const animatedHeight = pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [
            height,
            uiState.shouldAnimateVisualizer
              ? height + 18 + pulseOffset * 18
              : height,
            height,
          ],
        });

        return (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                backgroundColor: uiState.accentColor,
                height: animatedHeight,
                opacity: uiState.shouldAnimateVisualizer ? 0.84 : 0.36,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  visualizer: {
    width: "100%",
    maxWidth: 320,
    height: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  processing: {
    opacity: 0.7,
  },
  bar: {
    width: 5,
    borderRadius: 5,
    backgroundColor: webTheme.colors.primary,
  },
});
