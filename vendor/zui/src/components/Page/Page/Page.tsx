import type { ReactNode } from 'react';
import clsx from 'clsx';
import { PageHeader } from '../PageHeader';
import styles from './Page.module.css';

export interface PageProps {
  /** Page title */
  title: string;
  /** Optional subtitle or description */
  subtitle?: ReactNode;
  /** Item count to display next to title */
  count?: number;
  /** Actions to render in header right side (buttons, filters, etc.) */
  actions?: ReactNode;
  /** Loading state */
  isLoading?: boolean;
  /** Loading text to display */
  loadingText?: string;
  /** Main content */
  children: ReactNode;
  /** Additional className for the page container */
  className?: string;
}

export function Page({
  title,
  subtitle,
  count,
  actions,
  isLoading = false,
  loadingText = 'Loading...',
  children,
  className,
}: PageProps) {
  return (
    <div className={clsx(styles.page, className)}>
      <PageHeader 
        title={title} 
        {...(subtitle !== undefined && { subtitle })}
        {...(count !== undefined && { count })}
        {...(actions !== undefined && { actions })}
      />

      <div className={styles.content}>
        {isLoading ? (
          <div className={styles.loadingState}>
            <span className={styles.loadingText}>{loadingText}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
