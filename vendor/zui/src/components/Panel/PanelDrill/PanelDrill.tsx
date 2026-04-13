import type { ReactNode, ForwardedRef } from 'react';
import { forwardRef, useMemo } from 'react';
import clsx from 'clsx';
import { Panel } from '../Panel';
import type { PanelProps } from '../Panel';
import { Breadcrumb } from '../../Breadcrumb';
import type { BreadcrumbItem } from '../../Breadcrumb';
import styles from './PanelDrill.module.css';

export interface PanelDrillItem {
  /** Unique identifier for the panel */
  id: string;
  /** Label shown in the breadcrumb */
  label: string;
  /** Content to render when this panel is active */
  content: ReactNode;
  /** Optional action element rendered on the far right of the header */
  action?: ReactNode;
}

export interface PanelDrillProps extends Omit<PanelProps, 'children'> {
  /** Stack of panels - last item is the active/visible panel */
  stack: PanelDrillItem[];
  /** Callback when user navigates via breadcrumb */
  onNavigate?: (id: string, index: number) => void;
  /** Whether to show the breadcrumb navigation (default: true) */
  showBreadcrumb?: boolean;
  /** Custom separator for breadcrumb (default: "/") */
  breadcrumbSeparator?: ReactNode;
}

/**
 * PanelDrill - A panel with stack-based navigation and breadcrumb
 *
 * Provides drill-down navigation within a panel. Parent manages the stack
 * of panels, and this component renders the active (last) panel with a
 * breadcrumb for navigation back to previous levels.
 *
 * @example
 * ```tsx
 * const [stack, setStack] = useState<PanelDrillItem[]>([
 *   { id: 'root', label: 'Settings', content: <SettingsMain /> }
 * ]);
 *
 * const pushPanel = (item: PanelDrillItem) => {
 *   setStack(prev => [...prev, item]);
 * };
 *
 * const navigateBack = (id: string, index: number) => {
 *   setStack(prev => prev.slice(0, index + 1));
 * };
 *
 * <PanelDrill
 *   stack={stack}
 *   onNavigate={navigateBack}
 *   variant="glass"
 *   borderRadius="md"
 * />
 * ```
 */
export const PanelDrill = forwardRef(function PanelDrill(
  {
    stack,
    onNavigate,
    showBreadcrumb = true,
    breadcrumbSeparator,
    className,
    ...panelProps
  }: PanelDrillProps,
  ref: ForwardedRef<HTMLDivElement>
) {
  // Convert stack to breadcrumb items
  const breadcrumbItems: BreadcrumbItem[] = useMemo(
    () => stack.map(({ id, label }) => ({ id, label })),
    [stack]
  );

  // Show breadcrumb when enabled (even with single item for consistent UI)
  const shouldShowBreadcrumb = showBreadcrumb;

  if (stack.length === 0) {
    return (
      <Panel ref={ref} className={clsx(styles.panelDrill, className)} {...panelProps}>
        <div className={styles.empty}>No content</div>
      </Panel>
    );
  }

  return (
    <Panel ref={ref} className={clsx(styles.panelDrill, className)} {...panelProps}>
      {shouldShowBreadcrumb && (
        <div className={styles.header}>
          <Breadcrumb
            items={breadcrumbItems}
            onNavigate={onNavigate}
            separator={breadcrumbSeparator}
            className={styles.breadcrumb}
          />
          {stack[stack.length - 1]?.action && (
            <div className={styles.action}>
              {stack[stack.length - 1].action}
            </div>
          )}
        </div>
      )}
      <div className={styles.panels}>
        {stack.map((panel, index) => {
          const isActive = index === stack.length - 1;
          return (
            <div
              key={panel.id}
              className={clsx(
                styles.content,
                isActive ? styles.active : styles.hidden
              )}
              aria-hidden={!isActive}
            >
              {panel.content}
            </div>
          );
        })}
      </div>
    </Panel>
  );
});

PanelDrill.displayName = 'PanelDrill';
