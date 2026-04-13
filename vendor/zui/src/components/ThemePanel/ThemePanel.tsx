import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Palette } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../Button';
import { useTheme } from '../Theme/useTheme';
import { THEMES, ACCENT_COLORS } from '../Theme/ThemeContext';
import type { Theme, AccentColor } from '../Theme/ThemeContext';
import styles from './ThemePanel.module.css';

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

const ACCENT_LABELS: Record<AccentColor, string> = {
  cyan: 'Cyan',
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  orange: 'Orange',
  rose: 'Rose',
};

export interface ThemePanelProps {
  /** Additional CSS class name */
  className?: string;
}

/**
 * ThemePanel - A dropdown panel for theme and accent color selection
 *
 * @example
 * ```tsx
 * // In your topbar actions
 * <Topbar
 *   title="My App"
 *   actions={<ThemePanel />}
 * />
 * ```
 */
export function ThemePanel({ className }: ThemePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [offsetY, setOffsetY] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme, accent, setTheme, setAccent } = useTheme();

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Adjust position if panel would go off-screen
  useLayoutEffect(() => {
    if (isOpen && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const padding = 8;

      if (rect.bottom > viewportHeight - padding) {
        const overflow = rect.bottom - viewportHeight + padding;
        setOffsetY(-overflow);
      } else {
        setOffsetY(0);
      }

      if (rect.right > viewportWidth - padding) {
        const overflow = rect.right - viewportWidth + padding;
        setOffsetX(-overflow);
      } else {
        setOffsetX(0);
      }
    } else {
      setOffsetY(0);
      setOffsetX(0);
    }
  }, [isOpen]);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
  };

  const handleAccentChange = (newAccent: AccentColor) => {
    setAccent(newAccent);
  };

  return (
    <div className={clsx(styles.container, className)} ref={containerRef}>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        onClick={() => setIsOpen(!isOpen)}
        className={isOpen ? styles.triggerActive : undefined}
        aria-label="Theme settings"
        aria-expanded={isOpen}
      >
        <Palette size={16} />
      </Button>

      {isOpen && (
        <div
          ref={panelRef}
          className={styles.panel}
          style={
            offsetX !== 0 || offsetY !== 0
              ? { transform: `translate(${offsetX}px, ${offsetY}px)` }
              : undefined
          }
        >
          {/* Theme Mode Section */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Theme</span>
            <div className={styles.themeButtons}>
              {THEMES.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={theme === t ? 'filled' : 'ghost'}
                  onClick={() => handleThemeChange(t)}
                >
                  {THEME_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          {/* Accent Color Section */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Accent</span>
            <div className={styles.accentSwatches}>
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  className={clsx(
                    styles.swatch,
                    styles[`swatch${color.charAt(0).toUpperCase() + color.slice(1)}`],
                    accent === color && styles.swatchSelected
                  )}
                  onClick={() => handleAccentChange(color)}
                  aria-label={ACCENT_LABELS[color]}
                  title={ACCENT_LABELS[color]}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
