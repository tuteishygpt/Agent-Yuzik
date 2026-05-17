import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing } from "react-native";

import type { VoiceUiState } from "./voice-ui-state";

function usePulseLoop(
  shouldAnimate: boolean,
  duration: number,
  easing: (value: number) => number = Easing.inOut(Easing.ease),
  useNativeDriver = true,
) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.stopAnimation();
    value.setValue(0);

    if (!shouldAnimate) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing,
          useNativeDriver,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration,
          easing,
          useNativeDriver,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [value, shouldAnimate, duration, easing, useNativeDriver]);

  return value;
}

function useLinearLoop(
  shouldAnimate: boolean,
  duration: number,
  useNativeDriver = false,
) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.stopAnimation();
    value.setValue(0);

    if (!shouldAnimate) return;

    const loop = Animated.loop(
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver,
      }),
    );

    loop.start();
    return () => loop.stop();
  }, [value, shouldAnimate, duration, useNativeDriver]);

  return value;
}

const MIC_DURATIONS: Record<string, number> = {
  idle: 1800,
  default: 780,
};

const HALO_DURATIONS: Record<string, number> = {
  processing: 1050,
  default: 820,
};

const VISUALIZER_DURATIONS: Record<string, number> = {
  processing: 920,
  default: 680,
};

export function useVoiceAnimations(uiState: VoiceUiState) {
  const micDuration = MIC_DURATIONS[uiState.phase] ?? MIC_DURATIONS.default;
  const haloDuration = HALO_DURATIONS[uiState.phase] ?? HALO_DURATIONS.default;
  const vizDuration =
    VISUALIZER_DURATIONS[uiState.phase] ?? VISUALIZER_DURATIONS.default;

  const micPulse = usePulseLoop(uiState.shouldAnimateMic, micDuration);
  const haloPulse = usePulseLoop(uiState.shouldAnimateHalo, haloDuration);
  const dotPulse = usePulseLoop(uiState.shouldPulseConnection, 700);
  const visualizerPulse = useLinearLoop(
    uiState.shouldAnimateVisualizer,
    vizDuration,
  );

  const styles = useMemo(
    () => ({
      mic: {
        transform: [
          {
            scale: micPulse.interpolate({
              inputRange: [0, 1],
              outputRange:
                uiState.phase === "idle" ? [1, 1.025] : [1, 1.08],
            }),
          },
          {
            rotate:
              uiState.phase === "processing"
                ? micPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "10deg"],
                  })
                : "0deg",
          },
        ],
      },
      halo: {
        opacity: haloPulse.interpolate({
          inputRange: [0, 1],
          outputRange: uiState.shouldAnimateHalo ? [0.28, 0.62] : [0.18, 0.18],
        }),
        transform: [
          {
            scale: haloPulse.interpolate({
              inputRange: [0, 1],
              outputRange: uiState.shouldAnimateHalo ? [1, 1.32] : [1, 1],
            }),
          },
        ],
      },
      dot: {
        opacity: dotPulse.interpolate({
          inputRange: [0, 1],
          outputRange: uiState.shouldPulseConnection ? [0.45, 1] : [1, 1],
        }),
        transform: [
          {
            scale: dotPulse.interpolate({
              inputRange: [0, 1],
              outputRange: uiState.shouldPulseConnection
                ? [0.9, 1.35]
                : [1, 1],
            }),
          },
        ],
      },
    }),
    [
      dotPulse,
      haloPulse,
      micPulse,
      uiState.phase,
      uiState.shouldAnimateHalo,
      uiState.shouldPulseConnection,
    ],
  );

  return { styles, visualizerPulse };
}
