import { type ReactNode, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Topbar.module.css';

export interface TopbarProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /** Icon to display on the left */
  icon?: ReactNode;
  /** Title/name text or element */
  title: ReactNode;
  /** Optional actions slot for the right side */
  actions?: ReactNode;
}

/**
 * Topbar - A horizontal app header bar with left-aligned title and optional right-aligned actions
 *
 * @example
 * ```tsx
 * <Topbar title="My App" />
 *
 * <Topbar
 *   icon={<Logo />}
 *   title="My App"
 *   actions={<Button>Settings</Button>}
 * />
 * ```
 */
export function Topbar({ icon, title, actions, className, ...props }: TopbarProps) {
  return (
    <header className={clsx(styles.topbar, className)} {...props}>
      <div className={styles.left}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <span className={styles.title}>{title}</span>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
