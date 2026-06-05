import { create } from "zustand";
import i18n, {
  LANGUAGE_STORAGE_KEY,
  applyDocumentLanguage,
  detectInitialLanguage,
} from "../i18n";
import { isSupportedLanguage, resolveLanguage } from "../i18n/languages";

interface LanguageState {
  language: string;
  setLanguage: (code: string) => void;
}

function persist(code: string): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Ignore quota / privacy-mode failures; the in-memory store still works.
  }
}

/**
 * Single source of truth for the active locale, shared by the Settings
 * Language section and the public-shell language dropdown. Writing here
 * drives i18next, persistence, and the `<html lang>`/`dir` attributes so
 * every surface stays in sync from one action.
 */
export const useLanguageStore = create<LanguageState>((set) => ({
  language: detectInitialLanguage(),
  setLanguage: (code: string) => {
    const next = isSupportedLanguage(code) ? code : resolveLanguage(code);
    set({ language: next });
    persist(next);
    void i18n.changeLanguage(next);
    applyDocumentLanguage(next);
  },
}));
