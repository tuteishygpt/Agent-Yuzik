import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Locale = "be" | "en";

const translations = {
  be: {
    "tab.chat": "Чат",
    "tab.teacher": "Заняткі",
    "tab.voice": "Голас",
    "tab.settings": "Наладкі",

    "chat.placeholder": "Напішыце Юзіку...",
    "chat.footer": "Юзік можа рабіць памылкі. Правярайце важную інфармацыю.",
    "chat.loadingHistory": "Загрузка гісторыі...",
    "chat.emptyTitle": "Вітаю, я Юзік",
    "chat.emptySubtitle": "Я дапамагаю пісаць, гаварыць і ствараць па-беларуску",
    "chat.promptEssay": "Напісаць эсэ",
    "chat.promptEssaySub": "Пра гісторыю Беларусі",
    "chat.promptExplain": "Патлумач слова",
    "chat.promptExplainSub": "Беларускае значэнне",
    "chat.promptCreate": "Ствары выяву",
    "chat.promptCreateSub": "Па апісанні",
    "chat.promptTranslate": "Практыка мовы",
    "chat.promptTranslateSub": "Размова па-беларуску",
    "chat.imageCached": "Выява захавана",
    "chat.audioCached": "Аўдыё захавана",
    "chat.play": "Прайграць",
    "chat.open": "Адкрыць",
    "chat.share": "Падзяліцца",

    "voice.title": "Галасавы агент",
    "voice.listening": "Слухаю...",
    "voice.processing": "Думаю...",
    "voice.speaking": "Гавару...",
    "voice.idle": "Націсні для размовы",
    "voice.start": "Пачаць",
    "voice.stop": "Спыніць",
    "voice.teacher": "Заняткі",

    "settings.eyebrow": "Наладкі",
    "settings.title": "Наладкі",
    "settings.subtitle": "Асяроддзе і дыягностыка зборкі.",
    "settings.language": "Мова",
    "settings.voice": "Голас",
    "settings.nativeTenVad": "Native TEN VAD",
    "settings.nativeTenVadDescription":
      "Уключае Android native TEN VAD. Адключыце на эмулятары, калі ўвод голасу ці прайграванне становяцца нестабільнымі.",
    "settings.authLoading": "Загрузка аўтэнтыфікацыі",
    "settings.signedOut": "Выйшлі",
    "settings.guest": "Гасцявая сесія",
    "settings.email": "Email акаўнт",

    "auth.unavailable": "Аўтэнтыфікацыя недаступная",
    "auth.preparing": "Падрыхтоўка сесіі",
    "auth.errorDefault": "Немагчыма падрыхтаваць сесію Supabase.",
  },
  en: {
    "tab.chat": "Chat",
    "tab.teacher": "Classes",
    "tab.voice": "Voice",
    "tab.settings": "Settings",

    "chat.placeholder": "Write to Yuzik...",
    "chat.footer": "Yuzik can make mistakes. Verify important information.",
    "chat.loadingHistory": "Loading history...",
    "chat.emptyTitle": "Hello, I'm Yuzik",
    "chat.emptySubtitle": "I help write, speak, and create in Belarusian",
    "chat.promptEssay": "Write an essay",
    "chat.promptEssaySub": "About the history of Belarus",
    "chat.promptExplain": "Explain a word",
    "chat.promptExplainSub": "Belarusian meaning",
    "chat.promptCreate": "Create an image",
    "chat.promptCreateSub": "From a description",
    "chat.promptTranslate": "Language practice",
    "chat.promptTranslateSub": "Speak Belarusian",
    "chat.imageCached": "Image cached",
    "chat.audioCached": "Audio cached",
    "chat.play": "Play",
    "chat.open": "Open",
    "chat.share": "Share",

    "voice.title": "Voice Agent",
    "voice.listening": "Listening...",
    "voice.processing": "Thinking...",
    "voice.speaking": "Speaking...",
    "voice.idle": "Tap to talk",
    "voice.start": "Start",
    "voice.stop": "Stop",
    "voice.teacher": "Classes",

    "settings.eyebrow": "Settings",
    "settings.title": "Settings",
    "settings.subtitle": "Environment and build diagnostics.",
    "settings.language": "Language",
    "settings.voice": "Voice detection",
    "settings.nativeTenVad": "Native TEN VAD",
    "settings.nativeTenVadDescription":
      "Use the Android native TEN VAD detector. Turn this off on emulators if voice input or playback gets unstable.",
    "settings.authLoading": "Loading auth",
    "settings.signedOut": "Signed out",
    "settings.guest": "Guest session",
    "settings.email": "Email account",

    "auth.unavailable": "Auth unavailable",
    "auth.preparing": "Preparing session",
    "auth.errorDefault": "Unable to prepare a Supabase session.",
  },
} as const;

export type TranslationKey = keyof typeof translations.be;

const STORAGE_KEY = "yuzik_locale";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: "be",
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("be");

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((saved) => {
      if (saved === "en" || saved === "be") {
        setLocaleState(saved);
      }
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    SecureStore.setItemAsync(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[locale][key] ?? key;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
