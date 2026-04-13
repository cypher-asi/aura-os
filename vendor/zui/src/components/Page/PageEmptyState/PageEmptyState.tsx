import type { ReactNode } from 'react';
import styles from './PageEmptyState.module.css';

export interface PageEmptyStateProps {
  /** Icon to display */
  icon?: ReactNode;
  /** Main title text */
  title: string;
  /** Optional description text */
  description?: string;
  /** Action buttons */
  actions?: ReactNode;
}

export function PageEmptyState({ icon, title, description, actions }: PageEmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyContent}>
        {icon && <div className={styles.emptyIcon}>{icon}</div>}
        <div className={styles.emptyText}>
          <p className={styles.emptyTitle}>{title}</p>
          {description && <p className={styles.emptyDesc}>{description}</p>}
        </div>
        {actions && <div className={styles.emptyActions}>{actions}</div>}
      </div>
    </div>
  );
}
