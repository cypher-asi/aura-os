import { forwardRef, createContext, useContext, type MouseEvent } from 'react';
import clsx from 'clsx';
import type {
  ItemProps,
  ItemIconProps,
  ItemLabelProps,
  ItemChevronProps,
  ItemActionProps,
  ItemSpacerProps,
} from '../types';
import styles from './Item.module.css';

// ============================================================================
// Item Context (for sharing state between compound components)
// ============================================================================

interface ItemInternalContext {
  disabled?: boolean;
}

const ItemContext = createContext<ItemInternalContext>({});

function useItemContext() {
  return useContext(ItemContext);
}

// ============================================================================
// Item.Icon - Icon slot component
// ============================================================================

function ItemIcon({ children, className }: ItemIconProps) {
  return <span className={clsx(styles.icon, className)}>{children}</span>;
}

ItemIcon.displayName = 'Item.Icon';

// ============================================================================
// Item.Label - Label slot component
// ============================================================================

function ItemLabel({ children, className }: ItemLabelProps) {
  return <span className={clsx(styles.label, className)}>{children}</span>;
}

ItemLabel.displayName = 'Item.Label';

// ============================================================================
// Item.Chevron - Expand/collapse toggle component
// ============================================================================

// Inline chevron SVG to avoid button-in-button nesting
const ChevronIcon = ({ expanded, size }: { expanded: boolean; size: string }) => {
  const iconSize = size === 'xs' ? 12 : size === 'sm' ? 14 : 16;
  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx(styles.chevronIcon, expanded && styles.chevronIconExpanded)}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
};

function ItemChevron({
  expanded = false,
  onToggle,
  className,
  size = 'sm',
  showSpacer = true,
}: ItemChevronProps) {
  const { disabled } = useItemContext();

  const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (!disabled && onToggle) {
      onToggle(e as unknown as MouseEvent<HTMLButtonElement>);
    }
  };

  // If no onToggle provided, show spacer for alignment (optional)
  if (!onToggle && showSpacer) {
    return <span className={clsx(styles.chevronSpacer, className)} />;
  }

  if (!onToggle) {
    return null;
  }

  return (
    <span
      className={clsx(styles.chevron, disabled && styles.chevronDisabled, className)}
      onClick={handleClick}
      role="button"
      tabIndex={-1}
      aria-label={expanded ? 'Collapse' : 'Expand'}
      title={expanded ? 'Collapse' : 'Expand'}
    >
      <ChevronIcon expanded={expanded} size={size} />
    </span>
  );
}

ItemChevron.displayName = 'Item.Chevron';

// ============================================================================
// Item.Action - Right-aligned action slot component
// ============================================================================

function ItemAction({ children, className }: ItemActionProps) {
  return <span className={clsx(styles.action, className)}>{children}</span>;
}

ItemAction.displayName = 'Item.Action';

// ============================================================================
// Item.Spacer - Placeholder for chevron alignment
// ============================================================================

function ItemSpacer({ className }: ItemSpacerProps) {
  return <span className={clsx(styles.chevronSpacer, className)} />;
}

ItemSpacer.displayName = 'Item.Spacer';

// ============================================================================
// Item - Main component
// ============================================================================

/**
 * Item - A composable item component for navigation, trees, and menus
 *
 * Uses compound component pattern for flexible composition:
 * - `Item.Icon` - Icon slot
 * - `Item.Label` - Text label with truncation
 * - `Item.Chevron` - Expand/collapse toggle
 * - `Item.Action` - Right-aligned action slot
 * - `Item.Spacer` - Placeholder for alignment
 *
 * @example
 * ```tsx
 * // Simple navigation item
 * <Item active onClick={handleClick}>
 *   <Item.Icon><HomeIcon /></Item.Icon>
 *   <Item.Label>Home</Item.Label>
 * </Item>
 *
 * // Tree item with expand/collapse
 * <Item selected indent={20}>
 *   <Item.Chevron expanded={isExpanded} onToggle={handleToggle} />
 *   <Item.Icon><FolderIcon /></Item.Icon>
 *   <Item.Label>Documents</Item.Label>
 * </Item>
 *
 * // Menu item with action
 * <Item onClick={handleClick}>
 *   <Item.Icon><SettingsIcon /></Item.Icon>
 *   <Item.Label>Settings</Item.Label>
 *   <Item.Action><ChevronRight /></Item.Action>
 * </Item>
 * ```
 */
const ItemRoot = forwardRef<HTMLButtonElement, ItemProps>(
  (
    {
      id,
      selected = false,
      active,
      disabled = false,
      indent = 0,
      onClick,
      onKeyDown,
      children,
      className,
      style,
      role,
      hasChildren,
      expanded,
      level,
      ...props
    },
    ref
  ) => {
    // Support both selected and active (active is alias for NavItem compatibility)
    const isSelected = selected || active || false;

    // Compute styles with indentation
    const computedStyle = indent > 0 ? { ...style, paddingLeft: indent } : style;

    // Build ARIA attributes for tree items
    const ariaProps: Record<string, unknown> = {};
    if (level !== undefined) {
      ariaProps['aria-level'] = level + 1;
    }
    if (hasChildren !== undefined) {
      ariaProps['aria-expanded'] = expanded;
    }

    return (
      <ItemContext.Provider value={{ disabled }}>
        <button
          ref={ref}
          type="button"
          id={id}
          className={clsx(
            styles.item,
            isSelected && styles.selected,
            disabled && styles.disabled,
            className
          )}
          style={computedStyle}
          onClick={disabled ? undefined : onClick}
          onKeyDown={disabled ? undefined : onKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          aria-selected={isSelected}
          aria-current={isSelected ? 'page' : undefined}
          role={role}
          tabIndex={disabled ? -1 : 0}
          {...ariaProps}
          {...props}
        >
          {children}
        </button>
      </ItemContext.Provider>
    );
  }
);

ItemRoot.displayName = 'Item';

// ============================================================================
// Compound Component Export
// ============================================================================

type ItemComponent = typeof ItemRoot & {
  Icon: typeof ItemIcon;
  Label: typeof ItemLabel;
  Chevron: typeof ItemChevron;
  Action: typeof ItemAction;
  Spacer: typeof ItemSpacer;
};

export const Item = ItemRoot as ItemComponent;
Item.Icon = ItemIcon;
Item.Label = ItemLabel;
Item.Chevron = ItemChevron;
Item.Action = ItemAction;
Item.Spacer = ItemSpacer;
