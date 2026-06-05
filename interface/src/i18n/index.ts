import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  directionFor,
  resolveLanguage,
} from "./languages";

/**
 * Persisted locale key. Read here (and in `language-store`) so the very
 * first render uses the user's saved choice without a flash of English.
 */
export const LANGUAGE_STORAGE_KEY = "aura-language";

export const I18N_NAMESPACES = ["common", "nav", "auth", "settings"] as const;

function readStoredLanguage(): string | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!raw) return null;
    // Tolerate both a bare string and a JSON-wrapped value.
    const value = raw.startsWith("\"") ? (JSON.parse(raw) as string) : raw;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function detectInitialLanguage(): string {
  const stored = readStoredLanguage();
  if (stored) return resolveLanguage(stored);
  if (typeof navigator !== "undefined") {
    return resolveLanguage(navigator.language ?? navigator.languages?.[0]);
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Keep `<html lang>` and `<html dir>` in sync with the active locale so
 * the browser applies correct hyphenation, font selection, and RTL
 * mirroring across both the public and authenticated surfaces.
 */
export function applyDocumentLanguage(code: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("lang", code);
  root.setAttribute("dir", directionFor(code));
}

void i18n
  .use(
    resourcesToBackend(
      (language: string, namespace: string) =>
        import(`../locales/${language}/${namespace}.json`),
    ),
  )
  .use(initReactI18next)
  .init({
    lng: detectInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES as string[],
    ns: I18N_NAMESPACES as unknown as string[],
    defaultNS: "common",
    load: "currentOnly",
    interpolation: {
      // React already escapes interpolated values.
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
  });

i18n.on("languageChanged", (lng) => {
  applyDocumentLanguage(lng);
});

// Stamp the initial language/dir as early as possible.
applyDocumentLanguage(i18n.language || detectInitialLanguage());

export default i18n;
