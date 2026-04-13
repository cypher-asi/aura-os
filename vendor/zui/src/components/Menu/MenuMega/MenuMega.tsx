import { type ReactNode, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import type { MenuBackground, MenuRounded, MenuBorder } from '../Menu';
import type { ItemDetailedProps } from '../../Item';
import styles from './MenuMega.module.css';

// ============================================================================
// TypewriterText - Renders text with character-by-character animation
// ============================================================================

interface TypewriterTextProps {
  text: string;
  /** Base delay before animation starts (ms) */
  baseDelay?: number;
  /** Delay between each character (ms) */
  charDelay?: number;
}

function TypewriterText({
  text,
  baseDelay = 100,
  charDelay = 40,
}: TypewriterTextProps): JSX.Element {
  const characters = useMemo(() => text.split(''), [text]);

  return (
    <>
      {characters.map((char, index) => (
        <span
          key={index}
          className={styles.typewriterChar}
          style={{ animationDelay: `${baseDelay + index * charDelay}ms` }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </>
  );
}

// ============================================================================
// Types
// ============================================================================

/**
 * @deprecated Use ItemDetailedProps from '../../Item' instead.
 * This alias is kept for backwards compatibility.
 */
export type MenuMegaItemProps = ItemDetailedProps;

/** A column of mega menu items */
export interface MenuMegaColumnProps {
  /** Optional column header */
  title?: string;
  /** Items in this column (uses ItemDetailedProps) */
  items: ItemDetailedProps[];
}

/** Main MenuMega component props */
export interface MenuMegaProps {
  /** Array of columns (1 = single column, 2+ = multi-column layout) */
  columns: MenuMegaColumnProps[];
  /** Currently selected item id (controlled) */
  value?: string;
  /** Selection callback (controlled) */
  onChange?: (id: string) => void;
  /**
   * Background style variant
   * @default 'solid'
   */
  background?: MenuBackground;
  /**
   * Corner radius
   * @default 'none'
   */
  rounded?: MenuRounded;
  /**
   * Border style
   * @default 'none'
   */
  border?: MenuBorder;
  /** Total panel width */
  width?: number | string;
  /**
   * Optional vertical image displayed on the right side of the menu.
   * Pass an image URL string or a ReactNode for custom content.
   */
  image?: string | ReactNode;
  /** Additional CSS class */
  className?: string;
}

// ============================================================================
// MenuMegaItem - Internal component for rendering a single mega menu item
// Wraps ItemDetailedProps with mega menu-specific typewriter animation
// ============================================================================

interface MenuMegaItemComponentProps {
  item: ItemDetailedProps;
  itemIndex: number;
  isSelected: boolean;
  onSelect: ((id: string) => void) | undefined;
}

function MenuMegaItemComponent({
  item,
  itemIndex,
  isSelected,
  onSelect,
}: MenuMegaItemComponentProps): JSX.Element {
  const handleClick = useCallback(() => {
    if (!item.disabled && onSelect) {
      onSelect(item.id);
    }
  }, [item.disabled, item.id, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !item.disabled && onSelect) {
        e.preventDefault();
        onSelect(item.id);
      }
    },
    [item.disabled, item.id, onSelect]
  );

  // Calculate typewriter delay based on item index (matching item animation delays)
  const typewriterBaseDelay = 150 + itemIndex * 150;

  return (
    <button
      type="button"
      className={clsx(
        styles.item,
        isSelected && styles.selected,
        item.disabled && styles.disabled
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={item.disabled}
      role="menuitem"
      aria-selected={isSelected}
      aria-disabled={item.disabled}
      tabIndex={item.disabled ? -1 : 0}
    >
      {item.icon && <span className={styles.icon}>{item.icon}</span>}
      <span className={styles.content}>
        <span className={styles.label}>
          <TypewriterText text={item.label} baseDelay={typewriterBaseDelay} charDelay={25} />
        </span>
        {item.description && (
          <span className={styles.description}>{item.description}</span>
        )}
      </span>
    </button>
  );
}

// ============================================================================
// MenuMegaColumn - Internal component for rendering a column of items
// ============================================================================

interface MenuMegaColumnComponentProps {
  column: MenuMegaColumnProps;
  columnIndex: number;
  value: string | undefined;
  onChange: ((id: string) => void) | undefined;
}

function MenuMegaColumnComponent({
  column,
  columnIndex,
  value,
  onChange,
}: MenuMegaColumnComponentProps): JSX.Element {
  // Stagger typewriter start based on column index
  const typewriterBaseDelay = 50 + columnIndex * 150;

  return (
    <div className={styles.column} role="group" aria-label={column.title}>
      {column.title && (
        <div className={styles.columnTitle}>
          <TypewriterText
            text={column.title}
            baseDelay={typewriterBaseDelay}
            charDelay={25}
          />
        </div>
      )}
      <div className={styles.columnItems}>
        {column.items.map((item, index) => (
          <MenuMegaItemComponent
            key={item.id}
            item={item}
            itemIndex={index}
            isSelected={value === item.id}
            onSelect={onChange}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// MenuMega - Main component
// ============================================================================

export function MenuMega({
  columns,
  value,
  onChange,
  background = 'solid',
  rounded = 'none',
  border = 'none',
  width,
  image,
  className,
}: MenuMegaProps): JSX.Element {
  // Build border class - 'future' uses global class, others use CSS module
  const borderClass =
    border === 'future'
      ? 'border-future'
      : border !== 'none'
        ? styles[`border${border.charAt(0).toUpperCase() + border.slice(1)}`]
        : undefined;

  // Render image content - either an img element for string URLs or the ReactNode directly
  const imageContent = image ? (
    typeof image === 'string' ? (
      <img src={image} alt="" className={styles.imageElement} />
    ) : (
      image
    )
  ) : null;

  return (
    <div
      className={clsx(
        styles.megaMenu,
        styles[background],
        styles[`rounded${rounded.charAt(0).toUpperCase() + rounded.slice(1)}`],
        borderClass,
        image && styles.hasImage,
        className
      )}
      style={{ width }}
      role="menu"
    >
      <div className={styles.mainContent}>
        <div
          className={styles.columns}
          style={{
            gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
          }}
        >
          {columns.map((column, index) => (
            <MenuMegaColumnComponent
              key={column.title || `column-${index}`}
              column={column}
              columnIndex={index}
              value={value}
              onChange={onChange}
            />
          ))}
        </div>
        {image && <div className={styles.imageContainer}>{imageContent}</div>}
      </div>
    </div>
  );
}

MenuMega.displayName = 'MenuMega';
