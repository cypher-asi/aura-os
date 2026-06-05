/**
 * Canonical list of languages AURA ships translations for. `code` is the
 * i18next/BCP-47 language tag, `nativeName` is the autonym shown in the
 * picker, `englishName` is the English exonym (for search), and `dir`
 * drives `document.documentElement.dir` for RTL scripts.
 *
 * `en` is the source-of-truth catalog; every other locale falls back to
 * it for any missing key, so partial translations never break the UI.
 */
export interface LanguageDef {
  readonly code: string;
  readonly nativeName: string;
  readonly englishName: string;
  readonly dir: "ltr" | "rtl";
}

export const LANGUAGES: readonly LanguageDef[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr" },
  { code: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr" },
  { code: "fr", nativeName: "Français", englishName: "French", dir: "ltr" },
  { code: "de", nativeName: "Deutsch", englishName: "German", dir: "ltr" },
  { code: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", dir: "ltr" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", dir: "ltr" },
  { code: "ru", nativeName: "Русский", englishName: "Russian", dir: "ltr" },
  { code: "zh-Hans", nativeName: "简体中文", englishName: "Chinese (Simplified)", dir: "ltr" },
  { code: "zh-Hant", nativeName: "繁體中文", englishName: "Chinese (Traditional)", dir: "ltr" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese", dir: "ltr" },
  { code: "ko", nativeName: "한국어", englishName: "Korean", dir: "ltr" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr" },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch", dir: "ltr" },
  { code: "pl", nativeName: "Polski", englishName: "Polish", dir: "ltr" },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", dir: "ltr" },
  { code: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", dir: "ltr" },
  { code: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", dir: "ltr" },
  { code: "th", nativeName: "ไทย", englishName: "Thai", dir: "ltr" },
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian", dir: "ltr" },
] as const;

export const DEFAULT_LANGUAGE = "en";

export const SUPPORTED_LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguageDef(code: string): LanguageDef | undefined {
  return LANGUAGE_BY_CODE.get(code);
}

export function isSupportedLanguage(code: string): boolean {
  return LANGUAGE_BY_CODE.has(code);
}

/**
 * Resolve an arbitrary BCP-47 tag (e.g. from `navigator.language`) to the
 * closest supported code: exact match first, then primary-subtag match
 * (`pt-PT` -> `pt-BR`, `zh-CN` -> `zh-Hans`), else the default.
 */
export function resolveLanguage(tag: string | null | undefined): string {
  if (!tag) return DEFAULT_LANGUAGE;
  if (LANGUAGE_BY_CODE.has(tag)) return tag;
  const lower = tag.toLowerCase();
  for (const code of SUPPORTED_LANGUAGE_CODES) {
    if (code.toLowerCase() === lower) return code;
  }
  const primary = lower.split("-")[0];
  if (primary === "zh") {
    // Default Chinese to Simplified unless a Traditional region is named.
    if (/(hant|tw|hk|mo)/.test(lower)) return "zh-Hant";
    return "zh-Hans";
  }
  if (primary === "pt") return "pt-BR";
  for (const code of SUPPORTED_LANGUAGE_CODES) {
    if (code.toLowerCase().split("-")[0] === primary) return code;
  }
  return DEFAULT_LANGUAGE;
}

export function directionFor(code: string): "ltr" | "rtl" {
  return LANGUAGE_BY_CODE.get(code)?.dir ?? "ltr";
}
