import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const PREFER_NATIVE_TEN_VAD_STORAGE_KEY = "yuzik.voice.prefer_native_ten_vad";
const DEFAULT_PREFER_NATIVE_TEN_VAD = false;

type VoiceSettingsContextValue = {
  preferNativeTenVad: boolean;
  setPreferNativeTenVad: (enabled: boolean) => void;
};

const VoiceSettingsContext = createContext<VoiceSettingsContextValue>({
  preferNativeTenVad: DEFAULT_PREFER_NATIVE_TEN_VAD,
  setPreferNativeTenVad: () => {},
});

export function VoiceSettingsProvider({ children }: { children: ReactNode }) {
  const [preferNativeTenVad, setPreferNativeTenVadState] = useState(
    DEFAULT_PREFER_NATIVE_TEN_VAD,
  );

  useEffect(() => {
    let active = true;

    SecureStore.getItemAsync(PREFER_NATIVE_TEN_VAD_STORAGE_KEY)
      .then((saved) => {
        if (!active) {
          return;
        }

        if (saved === "0") {
          setPreferNativeTenVadState(false);
        } else if (saved === "1") {
          setPreferNativeTenVadState(true);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const setPreferNativeTenVad = useCallback((enabled: boolean) => {
    setPreferNativeTenVadState(enabled);
    void Promise.resolve(
      SecureStore.setItemAsync(
        PREFER_NATIVE_TEN_VAD_STORAGE_KEY,
        enabled ? "1" : "0",
      ),
    ).catch(() => undefined);
  }, []);

  return (
    <VoiceSettingsContext.Provider
      value={{ preferNativeTenVad, setPreferNativeTenVad }}
    >
      {children}
    </VoiceSettingsContext.Provider>
  );
}

export function useVoiceSettings() {
  return useContext(VoiceSettingsContext);
}
