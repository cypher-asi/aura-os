import { useState, useEffect } from 'react';
import type { ResolvedTheme } from './ThemeContext';

/** Media query for detecting dark mode preference */
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

/**
 * Get the current system color scheme preference.
 * Returns 'dark' if matchMedia is not available (SSR safety).
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'dark';
  }
  return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light';
}

/**
 * Hook to detect and subscribe to OS color scheme preference changes.
 *
 * @returns The current system theme preference ('dark' or 'light')
 *
 * @example
 * ```tsx
 * const systemTheme = useSystemTheme();
 * console.log(systemTheme); // 'dark' or 'light'
 * ```
 */
export function useSystemTheme(): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia(DARK_MODE_QUERY);

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    // Legacy browsers (Safari < 14)
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return systemTheme;
}
