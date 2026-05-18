import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "be" | "en";

const translations = {
  be: {
    // Tabs
    "tab.chat": "Чат",
    "tab.voice": "Голас",
    "tab.settings": "Наладкі",

    // Chat
    "chat.placeholder": "Напішыце паведамленне...",
    "chat.footer": "Юзік можа рабіць памылкі. Правярайце важную інфармацыю.",
    "chat.loadingHistory": "Загрузка гісторыі...",
    "chat.emptyTitle": "Прывітанне, я Юзік",
    "chat.emptySubtitle": "Чым магу дапамагчы?",
    "chat.promptEssay": "Напісаць эсэ",
    "chat.promptEssaySub": "Пра гісторыю Беларусі",
    "chat.promptExplain": "Растлумачыць",
    "chat.promptExplainSub": "Як працуе AI?",
    "chat.promptCreate": "Стварыць выяву",
    "chat.promptCreateSub": "Футурыстычны Менск",
    "chat.promptTranslate": "Перакласці",
    "chat.promptTranslateSub": "Тэкст на ангельскую",
    "chat.imageCached": "Выява захавана",
    "chat.audioCached": "Аўдыё захавана",
    "chat.open": "Адкрыць",
    "chat.share": "Падзяліцца",

    // Voice
    "voice.title": "Галасавы Агент",
    "voice.listening": "Слухаю...",
    "voice.processing": "Думаю...",
    "voice.speaking": "Гавару...",
    "voice.idle": "Націсні для размовы",
    "voice.start": "Пачаць",
    "voice.stop": "Спыніць",
    "voice.teacher": "Настаўнік",

    // Settings
    "settings.eyebrow": "Наладкі",
    "settings.title": "Наладкі",
    "settings.subtitle": "Асяроддзе і дыягностыка зборкі.",
    "settings.language": "Мова",
    "settings.authLoading": "Загрузка аўтэнтыфікацыі",
    "settings.signedOut": "Выйшлі",
    "settings.guest": "Гасцявая сесія",
    "settings.email": "Email акаўнт",

    // Auth
    "auth.unavailable": "Аўтэнтыфікацыя недаступная",
    "auth.preparing": "Падрыхтоўка сесіі",
    "auth.errorDefault": "Немагчыма падрыхтаваць сесію Supabase.",
  },
  en: {
    // Tabs
    "tab.chat": "Chat",
    "tab.voice": "Voice",
    "tab.settings": "Settings",

    // Chat
    "chat.placeholder": "Type a message...",
    "chat.footer": "Yuzik can make mistakes. Verify important information.",
    "chat.loadingHistory": "Loading history...",
    "chat.emptyTitle": "Hello, I'm Yuzik",
    "chat.emptySubtitle": "How can I help?",
    "chat.promptEssay": "Write an essay",
    "chat.promptEssaySub": "About the history of Belarus",
    "chat.promptExplain": "Explain",
    "chat.promptExplainSub": "How does AI work?",
    "chat.promptCreate": "Create an image",
    "chat.promptCreateSub": "Futuristic Minsk",
    "chat.promptTranslate": "Translate",
    "chat.promptTranslateSub": "Text to English",
    "chat.imageCached": "Image cached",
    "chat.audioCached": "Audio cached",
    "chat.open": "Open",
    "chat.share": "Share",

    // Voice
    "voice.title": "Voice Agent",
    "voice.listening": "Listening...",
    "voice.processing": "Thinking...",
    "voice.speaking": "Speaking...",
    "voice.idle": "Tap to talk",
    "voice.start": "Start",
    "voice.stop": "Stop",
    "voice.teacher": "Teacher",

    // Settings
    "settings.eyebrow": "Settings",
    "settings.title": "Settings",
    "settings.subtitle": "Environment and build diagnostics.",
    "settings.language": "Language",
    "settings.authLoading": "Loading auth",
    "settings.signedOut": "Signed out",
    "settings.guest": "Guest session",
    "settings.email": "Email account",

    // Auth
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
