import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  ThemeContext,
  type Theme,
  type AccentColor,
  type ResolvedTheme,
  type ThemeContextValue,
} from './ThemeContext';
import { useSystemTheme } from './useSystemTheme';

/** Stored theme preferences shape */
interface StoredTheme {
  theme: Theme;
  accent: AccentColor;
}

/** Default storage key */
const DEFAULT_STORAGE_KEY = 'zui-theme';

/**
 * Get stored theme preferences from localStorage.
 */
function getStoredTheme(storageKey: string): StoredTheme | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredTheme;
      // Validate the parsed values
      if (
        (parsed.theme === 'dark' || parsed.theme === 'light' || parsed.theme === 'system') &&
        ['cyan', 'blue', 'purple', 'green', 'orange', 'rose'].includes(parsed.accent)
      ) {
        return parsed;
      }
    }
  } catch {
    // localStorage might not be available or JSON might be invalid
  }

  return null;
}

/**
 * Save theme preferences to localStorage.
 */
function saveTheme(storageKey: string, theme: Theme, accent: AccentColor): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify({ theme, accent }));
  } catch {
    // localStorage might not be available
  }
}

/**
 * Apply theme attributes to the document root element.
 */
function applyThemeToDocument(resolvedTheme: ResolvedTheme, accent: AccentColor): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-theme', resolvedTheme);
  root.setAttribute('data-accent', accent);
}

export interface ThemeProviderProps {
  /** Child components */
  children: ReactNode;
  /** Default theme mode (defaults to 'dark') */
  defaultTheme?: Theme;
  /** Default accent color (defaults to 'cyan') */
  defaultAccent?: AccentColor;
  /** localStorage key for persisting preferences (defaults to 'zui-theme') */
  storageKey?: string;
  /** Force a specific theme (overrides user preference and storage) */
  forcedTheme?: ResolvedTheme;
  /** Disable transitions during theme change (prevents flash) */
  disableTransitionOnChange?: boolean;
}

/**
 * Theme provider component that manages theme state and applies CSS variables.
 *
 * Wrap your application with this provider to enable theming.
 *
 * @example
 * ```tsx
 * // Basic usage with defaults (dark theme, cyan accent)
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * @example
 * ```tsx
 * // Custom defaults
 * <ThemeProvider defaultTheme="light" defaultAccent="blue" storageKey="my-app-theme">
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * @example
 * ```tsx
 * // Force a specific theme (useful for previews or embeds)
 * <ThemeProvider forcedTheme="dark">
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  defaultAccent = 'cyan',
  storageKey = DEFAULT_STORAGE_KEY,
  forcedTheme,
  disableTransitionOnChange = false,
}: ThemeProviderProps) {
  // Get system theme preference
  const systemTheme = useSystemTheme();

  // Initialize state from storage or defaults
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme(storageKey);
    return stored?.theme ?? defaultTheme;
  });

  const [accent, setAccentState] = useState<AccentColor>(() => {
    const stored = getStoredTheme(storageKey);
    return stored?.accent ?? defaultAccent;
  });

  // Calculate resolved theme
  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (forcedTheme) {
      return forcedTheme;
    }
    if (theme === 'system') {
      return systemTheme;
    }
    return theme;
  }, [theme, systemTheme, forcedTheme]);

  // Apply theme to document when resolved theme or accent changes
  useEffect(() => {
    if (disableTransitionOnChange) {
      // Temporarily disable transitions
      const css = document.createElement('style');
      css.appendChild(
        document.createTextNode(
          '*, *::before, *::after { transition: none !important; }'
        )
      );
      document.head.appendChild(css);

      applyThemeToDocument(resolvedTheme, accent);

      // Force a reflow to ensure the transition disable is applied
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      window.getComputedStyle(document.documentElement).opacity;

      // Re-enable transitions
      document.head.removeChild(css);
    } else {
      applyThemeToDocument(resolvedTheme, accent);
    }
  }, [resolvedTheme, accent, disableTransitionOnChange]);

  // Theme setters with persistence
  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      saveTheme(storageKey, newTheme, accent);
    },
    [storageKey, accent]
  );

  const setAccent = useCallback(
    (newAccent: AccentColor) => {
      setAccentState(newAccent);
      saveTheme(storageKey, theme, newAccent);
    },
    [storageKey, theme]
  );

  // Memoize context value
  const contextValue: ThemeContextValue = useMemo(
    () => ({
      theme,
      accent,
      resolvedTheme,
      systemTheme,
      setTheme,
      setAccent,
    }),
    [theme, accent, resolvedTheme, systemTheme, setTheme, setAccent]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
