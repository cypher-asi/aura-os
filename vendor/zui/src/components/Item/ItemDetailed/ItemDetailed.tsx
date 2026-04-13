import { useCallback } from 'react';
import clsx from 'clsx';
import type { ItemDetailedProps } from '../types';
import styles from './ItemDetailed.module.css';

/**
 * ItemDetailed - A detailed item component with icon, label, and description.
 *
 * Used for mega menus, detailed lists, and other contexts requiring rich item display.
 * Renders a button element with icon on the left and label/description stacked on the right.
 *
 * @example
 * ```tsx
 * <ItemDetailed
 *   id="settings"
 *   icon={<SettingsIcon />}
 *   label="Settings"
 *   description="Configure your preferences"
 *   onClick={() => navigate('/settings')}
 * />
 * ```
 */
export function ItemDetailed({
  id,
  icon,
  label,
  description,
  disabled = false,
  selected = false,
  onClick,
  className,
  style,
  role = 'menuitem',
  tabIndex,
}: ItemDetailedProps): JSX.Element {
  const handleClick = useCallback(() => {
    if (!disabled && onClick) {
      onClick();
    }
  }, [disabled, onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !disabled && onClick) {
        e.preventDefault();
        onClick();
      }
    },
    [disabled, onClick]
  );

  return (
    <button
      type="button"
      id={id}
      className={clsx(
        styles.item,
        selected && styles.selected,
        disabled && styles.disabled,
        className
      )}
      style={style}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      role={role}
      aria-selected={selected}
      aria-disabled={disabled}
      tabIndex={tabIndex ?? (disabled ? -1 : 0)}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.content}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
    </button>
  );
}

ItemDetailed.displayName = 'ItemDetailed';
