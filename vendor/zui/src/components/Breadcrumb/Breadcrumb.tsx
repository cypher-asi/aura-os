import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  /** Unique identifier for the breadcrumb item */
  id: string;
  /** Display label */
  label: string;
}

export interface BreadcrumbProps {
  /** Array of breadcrumb items (first is root, last is current) */
  items: BreadcrumbItem[];
  /** Callback when user clicks a breadcrumb item */
  onNavigate?: (id: string, index: number) => void;
  /** Custom separator between items (default: "/") */
  separator?: ReactNode;
  /** Additional CSS class name */
  className?: string;
}

/**
 * Breadcrumb - Navigation component showing hierarchical path
 *
 * Uses semantic HTML with nav > ol > li structure for accessibility.
 * The last item is rendered as static text (current location),
 * while all previous items are clickable for navigation.
 *
 * @example
 * ```tsx
 * <Breadcrumb
 *   items={[
 *     { id: 'root', label: 'Settings' },
 *     { id: 'account', label: 'Account' },
 *     { id: 'security', label: 'Security' },
 *   ]}
 *   onNavigate={(id, index) => console.log('Navigate to', id)}
 * />
 * ```
 */
export function Breadcrumb({
  items,
  onNavigate,
  separator = '/',
  className,
}: BreadcrumbProps) {
  if (items.length === 0) {
    return null;
  }

  const handleClick = (item: BreadcrumbItem, index: number) => {
    // Don't navigate if it's the last (current) item
    if (index === items.length - 1) {
      return;
    }
    onNavigate?.(item.id, index);
  };

  return (
    <nav className={clsx(styles.breadcrumb, className)} aria-label="Breadcrumb">
      <ol className={styles.list}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = !isLast && onNavigate;

          return (
            <li key={item.id} className={styles.item}>
              {isClickable ? (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => handleClick(item, index)}
                  aria-current={undefined}
                >
                  {item.label}
                </button>
              ) : (
                <span
                  className={clsx(styles.label, isLast && styles.current)}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span className={styles.separator} aria-hidden="true">
                  {separator}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
