import { I18nProvider } from "@lingui/react";
import { track } from "./analytics";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { i18n, preferredLanguage } from "../i18n";
import { isLanguage, type Language } from "../types";

const STORAGE_KEY = "metro-language";

// A saved choice wins, otherwise the browser's preferred language.
function readInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && isLanguage(stored)) return stored;
  } catch {
    // Storage may be unavailable (private mode).
  }
  return (
    (typeof navigator !== "undefined" &&
      preferredLanguage(navigator.languages ?? [navigator.language])) ||
    "en"
  );
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = readInitialLanguage();
    i18n.activate(initial);
    return initial;
  });

  const setLanguage = useCallback((next: Language) => {
    track("change_language", { language: next });
    i18n.activate(next);
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice lasts this visit.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
