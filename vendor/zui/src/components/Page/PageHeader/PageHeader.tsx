import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './PageHeader.module.css';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Page or section title */
  title: string;
  
  /** Optional subtitle or description */
  subtitle?: ReactNode;
  
  /** Item count or other metadata to display next to title */
  count?: number | string;
  
  /** Actions to render in header right side (buttons, filters, etc.) */
  actions?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  count,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header className={clsx(styles.pageHeader, className)} {...props}>
      <div className={styles.headerLeft}>
        <div className={styles.titleContainer}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        {count !== undefined && <span className={styles.count}>{typeof count === 'number' ? count.toLocaleString() : count}</span>}
      </div>
      {actions && <div className={styles.headerRight}>{actions}</div>}
    </header>
  );
}
