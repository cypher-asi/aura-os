import { useState, type ReactNode, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import { ButtonCollapsible } from '../../Button';
import styles from '../Group.module.css';

export interface GroupCollapsibleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
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
  /** Whether the group starts collapsed (defaults to false when not specified) */
  defaultCollapsed?: boolean;
  /**
   * Alternative prop name for defaultCollapsed (for compatibility)
   * @deprecated Use `defaultCollapsed` with inverted logic instead
   */
  defaultOpen?: boolean;
  /** The content to render inside the group */
  children: ReactNode;
}

export function GroupCollapsible({
  label,
  title,
  count,
  stats,
  defaultCollapsed = false,
  defaultOpen,
  children,
  className,
  ...props
}: GroupCollapsibleProps) {
  // Support both label/title for compatibility (title is deprecated)
  const displayLabel = label || title || '';
  // Support both defaultCollapsed/defaultOpen for compatibility (defaultOpen is deprecated)
  const startCollapsed = defaultOpen !== undefined ? !defaultOpen : defaultCollapsed;
  const [isCollapsed, setIsCollapsed] = useState(startCollapsed);

  const handleToggle = () => setIsCollapsed(!isCollapsed);

  return (
    <div className={clsx(styles.group, className)} {...props}>
      <div className={styles.header}>
        <button
          className={styles.headerButton}
          onClick={handleToggle}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          type="button"
        >
          <span className={styles.labelContainer}>
            <span className={styles.label}>{displayLabel}</span>
            {count !== undefined && <span className={styles.count}>{count}</span>}
          </span>
          {stats && <div className={styles.stats}>{stats}</div>}
        </button>
        <ButtonCollapsible
          className={styles.toggle}
          isCollapsed={isCollapsed}
          onClick={handleToggle}
          ariaLabel={isCollapsed ? 'Expand' : 'Collapse'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        />
      </div>
      <div className={clsx(styles.content, isCollapsed && styles.contentCollapsed)}>
        <div className={styles.contentInner}>{children}</div>
      </div>
    </div>
  );
}
