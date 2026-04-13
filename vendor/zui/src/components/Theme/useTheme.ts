import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeContext';

/**
 * Hook to access and modify the current theme.
 *
 * Must be used within a ThemeProvider.
 *
 * @returns Theme context value with current theme state and setters
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { theme, resolvedTheme, setTheme } = useTheme();
 *
 *   return (
 *     <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
 *       Current: {resolvedTheme}
 *     </button>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * function AccentPicker() {
 *   const { accent, setAccent } = useTheme();
 *
 *   return (
 *     <select value={accent} onChange={(e) => setAccent(e.target.value as AccentColor)}>
 *       <option value="cyan">Cyan</option>
 *       <option value="blue">Blue</option>
 *       <option value="purple">Purple</option>
 *       <option value="green">Green</option>
 *       <option value="orange">Orange</option>
 *       <option value="rose">Rose</option>
 *     </select>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  return context;
}
