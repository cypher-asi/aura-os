import type { ReactNode, MouseEvent } from 'react';
import clsx from 'clsx';
import styles from './CardItem.module.css';

export interface CardItemProps {
  /** Whether this card is currently selected */
  selected?: boolean;
  /** Click handler for the card */
  onClick?: () => void;
  /** Icon badge content - can be text (e.g., "DO", "AWS") or a React node (icon) */
  iconBadge?: ReactNode;
  /** Main title/name of the item */
  title: ReactNode;
  /** Use sans-serif font for title instead of mono */
  titleSans?: boolean;
  /** Status badge content (rendered after title) */
  statusBadge?: ReactNode;
  /** Meta information row (icons + text) */
  meta?: ReactNode;
  /** Secondary content (e.g., IP address, code) */
  secondary?: ReactNode;
  /** Small badges (e.g., provider tags) */
  badges?: ReactNode;
  /** Action buttons (shown on hover) */
  actions?: ReactNode;
  /** Always show actions (don't wait for hover) */
  actionsAlwaysVisible?: boolean;
  /** Additional className */
  className?: string;
  /** Children for custom content */
  children?: ReactNode;
}

export function CardItem({
  selected,
  onClick,
  iconBadge,
  title,
  titleSans,
  statusBadge,
  meta,
  secondary,
  badges,
  actions,
  actionsAlwaysVisible,
  className,
  children,
}: CardItemProps) {
  const handleClick = () => {
    onClick?.();
  };

  return (
    <div
      className={clsx(styles.card, selected && styles.cardSelected, className)}
      onClick={handleClick}
    >
      {/* Icon badge */}
      {iconBadge && (
        <div className={styles.iconBadge}>
          {typeof iconBadge === 'string' ? (
            <span className={styles.iconBadgeText}>{iconBadge}</span>
          ) : (
            <span className={styles.iconBadgeIcon}>{iconBadge}</span>
          )}
        </div>
      )}

      {/* Main info */}
      <div className={styles.info}>
        <div className={styles.titleRow}>
          <span className={clsx(styles.title, titleSans && styles.titleSans)}>{title}</span>
          {statusBadge}
        </div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>

      {/* Custom children */}
      {children}

      {/* Badges */}
      {badges && <div className={styles.badges}>{badges}</div>}

      {/* Secondary content */}
      {secondary && <div className={styles.secondary}>{secondary}</div>}

      {/* Actions */}
      {actions && (
        <div
          className={clsx(styles.actions, actionsAlwaysVisible && styles.actionsAlwaysVisible)}
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

// Sub-components for building meta rows
export function CardItemMeta({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span className={clsx(styles.metaItem, mono && styles.metaMono)}>{children}</span>;
}

export function CardItemCode({ children }: { children: ReactNode }) {
  return <code className={styles.code}>{children}</code>;
}

export function CardItemBadge({ children }: { children: ReactNode }) {
  return <span className={styles.badge}>{children}</span>;
}

export function CardItemTypeBadge({ children }: { children: ReactNode }) {
  return <span className={styles.typeBadge}>{children}</span>;
}

// Status wrapper for consistent styling
export function CardItemStatus({
  children,
  variant = 'muted',
}: {
  children: ReactNode;
  variant?: 'valid' | 'invalid' | 'warning' | 'muted' | 'pending' | 'provisioning';
}) {
  const variantClass = {
    valid: styles.statusValid,
    invalid: styles.statusInvalid,
    warning: styles.statusWarning,
    muted: styles.statusMuted,
    pending: styles.statusPending,
    provisioning: styles.statusProvisioning,
  }[variant];

  return <span className={clsx(styles.status, variantClass)}>{children}</span>;
}
