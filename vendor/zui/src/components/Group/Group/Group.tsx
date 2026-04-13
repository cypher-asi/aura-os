import { type ReactNode, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from '../Group.module.css';

export interface GroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** The group label/title */
  label?: string;
  /**
   * Alternative prop name for label (for compatibility)
   * @deprecated Use `label` instead
   */
  title?: string;
  /** Count to display next to the label */
  count?: number;
  /** Optional stats to display (aligned to the right) */
  stats?: ReactNode;
  /** The content to render inside the group */
  children: ReactNode;
}

export function Group({
  label,
  title,
  count,
  stats,
  children,
  className,
  ...props
}: GroupProps) {
  // Support both label/title for compatibility (title is deprecated)
  const displayLabel = label || title || '';

  return (
    <div className={clsx(styles.group, className)} {...props}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <span className={styles.labelContainer}>
            <span className={styles.label}>{displayLabel}</span>
            {count !== undefined && <span className={styles.count}>{count}</span>}
          </span>
          {stats && <div className={styles.stats}>{stats}</div>}
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </div>
    </div>
  );
}
