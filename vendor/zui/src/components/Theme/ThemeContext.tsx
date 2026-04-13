import { createContext } from 'react';

/** Available theme modes */
export type Theme = 'dark' | 'light' | 'system';

/** Resolved theme (after system preference is applied) */
export type ResolvedTheme = 'dark' | 'light';

/** Available accent color palettes */
export type AccentColor = 'cyan' | 'blue' | 'purple' | 'green' | 'orange' | 'rose';

/** All available accent colors for iteration */
export const ACCENT_COLORS: AccentColor[] = ['cyan', 'blue', 'purple', 'green', 'orange', 'rose'];

/** All available themes for iteration */
export const THEMES: Theme[] = ['dark', 'light', 'system'];

/** Theme context value */
export interface ThemeContextValue {
  /** Current theme setting ('dark', 'light', or 'system') */
  theme: Theme;
  /** Current accent color */
  accent: AccentColor;
  /** Resolved theme after system preference (always 'dark' or 'light') */
  resolvedTheme: ResolvedTheme;
  /** Current system color scheme preference */
  systemTheme: ResolvedTheme;
  /** Set the theme mode */
  setTheme: (theme: Theme) => void;
  /** Set the accent color */
  setAccent: (accent: AccentColor) => void;
}

/** Default context value (used when no provider is present) */
const defaultContextValue: ThemeContextValue = {
  theme: 'dark',
  accent: 'cyan',
  resolvedTheme: 'dark',
  systemTheme: 'dark',
  setTheme: () => {
    console.warn('ThemeProvider not found. Wrap your app in <ThemeProvider>.');
  },
  setAccent: () => {
    console.warn('ThemeProvider not found. Wrap your app in <ThemeProvider>.');
  },
};

/** Theme context */
export const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);
