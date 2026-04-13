import { type ReactNode, useRef, useLayoutEffect, useState, useCallback, useEffect, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Item } from '../../Item';
import styles from './Menu.module.css';

export type MenuBackground = 'none' | 'solid' | 'transparent' | 'glass';
export type MenuRounded = 'none' | 'sm' | 'md' | 'lg';
export type MenuBorder = 'none' | 'solid' | 'future';

/** @deprecated Use MenuBackground instead */
export type MenuVariant = MenuBackground;

export interface MenuItemProps {
  /** Unique identifier for the item */
  id: string;
  /** The text label to display */
  label: string;
  /** Optional icon to display on the left */
  icon?: ReactNode;
  /** Optional status/data to display on the right (before submenu chevron) */
  status?: ReactNode;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Nested submenu items (creates a flyout submenu) */
  children?: MenuItemProps[];
}

/** Separator to visually divide groups of menu items */
export interface MenuSeparator {
  type: 'separator';
}

/** Union type for all menu item types */
export type MenuItem = MenuItemProps | MenuSeparator;

/** Type guard to check if item is a separator */
function isSeparator(item: MenuItem): item is MenuSeparator {
  return 'type' in item && item.type === 'separator';
}

/** Helper to check if an item id is in the selected value(s) */
function isItemSelected(id: string, value: string | string[] | undefined): boolean {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.includes(id);
  }
  return value === id;
}

export interface MenuProps {
  /** Optional title displayed at the top of the menu */
  title?: string;
  /** Array of menu items (including separators) */
  items: MenuItem[];
  /** 
   * Currently selected item id(s). 
   * Pass a string for single selection, or an array for multiple selections (e.g., one per submenu).
   */
  value?: string | string[];
  /** Callback when selection changes (called with the id of the clicked item) */
  onChange?: (id: string) => void;
  /**
   * @deprecated Use `value` instead
   */
  selectedId?: string;
  /**
   * @deprecated Use `onChange` instead
   */
  onSelect?: (id: string) => void;
  /**
   * Background style
   * @default 'solid'
   */
  background?: MenuBackground;
  /**
   * @deprecated Use `background` instead
   */
  variant?: MenuBackground;
  /**
   * Corner radius
   * @default 'none'
   */
  rounded?: MenuRounded;
  /**
   * Whether to show border
   * @default true
   * @deprecated Use `border` prop instead
   */
  bordered?: boolean;
  /**
   * Border style variant
   * @default 'none'
   */
  border?: MenuBorder;
  /** Additional CSS class name */
  className?: string;
  /** Menu width */
  width?: number | string;
  /**
   * Whether the menu is currently visible/open.
   * Used for off-screen detection when menu appears.
   */
  isOpen?: boolean;
  /**
   * Internal: depth level for nested submenus
   * @internal
   */
  _depth?: number;
  /**
   * Internal: callback to return focus to parent menu item when submenu closes
   * @internal
   */
  _onRequestClose?: () => void;
}

// ============================================================================
// MenuItem - Internal component for rendering a single menu item with submenu
// ============================================================================

interface MenuItemComponentProps {
  item: MenuItemProps;
  isSelected: boolean;
  isFocused: boolean;
  currentValue: string | string[] | undefined;
  onSelect: ((id: string) => void) | undefined;
  background: MenuBackground;
  rounded: MenuRounded;
  border: MenuBorder;
  depth: number;
  isSubmenuOpen: boolean;
  onSubmenuOpen: (id: string | null) => void;
  closeTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  itemRef: (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: () => void;
  /** Callback from submenu to return focus to parent item */
  onSubmenuClose?: () => void;
}

function MenuItemComponent({
  item,
  isSelected,
  isFocused,
  currentValue,
  onSelect,
  background,
  rounded,
  border,
  depth,
  isSubmenuOpen,
  onSubmenuOpen,
  closeTimeoutRef,
  itemRef,
  onKeyDown,
  onFocus,
  onSubmenuClose: _onSubmenuClose,
}: MenuItemComponentProps) {
  const [submenuPosition, setSubmenuPosition] = useState<'right' | 'left'>('right');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const hasSubmenu = item.children && item.children.length > 0;

  // Combine refs for the button element
  const setButtonRef = useCallback((el: HTMLButtonElement | null) => {
    buttonRef.current = el;
    itemRef(el);
  }, [itemRef]);

  // Calculate submenu position based on available space
  const updateSubmenuPosition = useCallback(() => {
    if (wrapperRef.current && hasSubmenu) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const submenuWidth = 200; // Estimated submenu width
      const padding = 8;

      // If not enough space on the right, position on the left
      if (rect.right + submenuWidth > viewportWidth - padding) {
        setSubmenuPosition('left');
      } else {
        setSubmenuPosition('right');
      }
    }
  }, [hasSubmenu]);

  const handleMouseEnter = useCallback(() => {
    // Clear any pending close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    
    if (hasSubmenu && !item.disabled) {
      updateSubmenuPosition();
      onSubmenuOpen(item.id);
    } else {
      // Close any open submenu when hovering a non-submenu item
      onSubmenuOpen(null);
    }
  }, [hasSubmenu, item.disabled, item.id, updateSubmenuPosition, onSubmenuOpen, closeTimeoutRef]);

  const handleMouseLeave = useCallback(() => {
    if (hasSubmenu && isSubmenuOpen) {
      // Delay closing to allow moving to submenu
      closeTimeoutRef.current = setTimeout(() => {
        onSubmenuOpen(null);
      }, 150);
    }
  }, [hasSubmenu, isSubmenuOpen, onSubmenuOpen, closeTimeoutRef]);

  const handleClick = useCallback(() => {
    if (!item.disabled && !hasSubmenu && onSelect) {
      onSelect(item.id);
    }
  }, [item.disabled, item.id, hasSubmenu, onSelect]);

  // Handle keyboard event for this item
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Let parent menu handle navigation keys
    onKeyDown(e);
  }, [onKeyDown]);

  // Callback to return focus from submenu to this item
  const handleSubmenuClose = useCallback(() => {
    // Close the submenu
    onSubmenuOpen(null);
    // Return focus to this item
    buttonRef.current?.focus();
  }, [onSubmenuOpen]);

  return (
    <div
      ref={wrapperRef}
      className={styles.menuItemWrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Item
        ref={setButtonRef}
        id={item.id}
        className={clsx(
          styles.menuItem,
          isSelected && styles.selected,
          item.disabled && styles.disabled,
          hasSubmenu && styles.hasSubmenu,
          isSubmenuOpen && styles.submenuOpen
        )}
        disabled={item.disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onMouseEnter={() => {
          // Clear close timeout when re-entering parent item from submenu
          if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
          }
        }}
        role="menuitem"
        aria-haspopup={hasSubmenu ? 'menu' : undefined}
        aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
        aria-selected={isSelected}
        tabIndex={isFocused ? 0 : -1}
      >
        {item.icon && <Item.Icon className={styles.icon}>{item.icon}</Item.Icon>}
        <Item.Label className={styles.label}>{item.label}</Item.Label>
        {item.status && <span className={styles.status}>{item.status}</span>}
        {hasSubmenu && (
          <Item.Action className={styles.submenuArrow}>
            <ChevronRight size={14} />
          </Item.Action>
        )}
      </Item>

      {/* Submenu */}
      {hasSubmenu && isSubmenuOpen && (
        <div
          className={clsx(
            styles.submenu,
            submenuPosition === 'left' && styles.submenuLeft
          )}
          onMouseEnter={() => {
            // Cancel close when entering submenu
            if (closeTimeoutRef.current) {
              clearTimeout(closeTimeoutRef.current);
              closeTimeoutRef.current = null;
            }
          }}
          onMouseLeave={handleMouseLeave}
        >
          <Menu
            items={item.children!}
            value={currentValue}
            onChange={onSelect}
            background={background}
            rounded={rounded}
            border={border}
            _depth={depth + 1}
            isOpen={isSubmenuOpen}
            _onRequestClose={handleSubmenuClose}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Menu - Main component
// ============================================================================

export function Menu({
  title,
  items,
  value,
  onChange,
  selectedId,
  onSelect,
  background,
  variant,
  rounded = 'none',
  bordered = true,
  border,
  className,
  width,
  isOpen,
  _depth = 0,
  _onRequestClose,
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [offsetY, setOffsetY] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  
  // Track which submenu is currently open (by item id)
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Support both old and new prop names (old names are deprecated)
  const currentValue = value ?? selectedId;
  const handleChange = onChange ?? onSelect;

  // Resolve background: new `background` prop takes precedence over deprecated `variant`
  const backgroundStyle = background ?? variant ?? 'solid';

  // Resolve border style: new `border` prop takes precedence over deprecated `bordered`
  const borderStyle = border ?? (bordered ? 'solid' : 'none');

  // Get focusable items (non-separator, non-disabled) with their original indices
  const focusableItems = items
    .map((item, index) => ({ item, index }))
    .filter((entry): entry is { item: MenuItemProps; index: number } => 
      !isSeparator(entry.item) && !(entry.item as MenuItemProps).disabled
    );

  // Find focused item data
  const focusedItemData = focusedIndex >= 0 ? focusableItems[focusedIndex] : null;

  // Keyboard navigation handler
  const handleMenuKeyDown = useCallback((e: KeyboardEvent) => {
    const itemCount = focusableItems.length;
    if (itemCount === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(prev => {
          const next = prev < 0 ? 0 : (prev + 1) % itemCount;
          return next;
        });
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(prev => {
          const next = prev < 0 ? itemCount - 1 : (prev - 1 + itemCount) % itemCount;
          return next;
        });
        break;

      case 'ArrowRight': {
        // Open submenu if current item has one
        const currentItem = focusedItemData?.item;
        if (currentItem && currentItem.children && currentItem.children.length > 0 && !currentItem.disabled) {
          e.preventDefault();
          e.stopPropagation();
          setOpenSubmenuId(currentItem.id);
        }
        break;
      }

      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        // If we're in a submenu, close it and return focus to parent
        if (_depth > 0 && _onRequestClose) {
          setOpenSubmenuId(null);
          _onRequestClose();
        }
        break;

      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(0);
        break;

      case 'End':
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(itemCount - 1);
        break;

      case 'Enter':
      case ' ':
        if (focusedItemData) {
          e.preventDefault();
          e.stopPropagation();
          const item = focusedItemData.item;
          if (item.children && item.children.length > 0) {
            // Open submenu
            setOpenSubmenuId(item.id);
          } else if (handleChange) {
            // Select item
            handleChange(item.id);
          }
        }
        break;

      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        // Close submenu and return to parent
        if (_depth > 0 && _onRequestClose) {
          setOpenSubmenuId(null);
          _onRequestClose();
        } else {
          // Close any open submenu at root level
          setOpenSubmenuId(null);
        }
        break;
    }
  }, [focusableItems, focusedItemData, _depth, _onRequestClose, handleChange]);

  // Focus the item when focusedIndex changes
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < focusableItems.length) {
      const originalIndex = focusableItems[focusedIndex].index;
      itemRefs.current[originalIndex]?.focus();
    }
  }, [focusedIndex, focusableItems]);

  // Auto-focus first item (or selected item) when menu opens
  // If isOpen is explicitly false, reset focus. Otherwise (true or undefined), set focus.
  useEffect(() => {
    if (isOpen === false) {
      setFocusedIndex(-1);
    } else if (focusableItems.length > 0 && focusedIndex < 0) {
      // Find selected item index if any
      const selectedIndex = focusableItems.findIndex(({ item }) => 
        isItemSelected(item.id, currentValue)
      );
      // Focus selected item, or first item
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [isOpen]); // Only depend on isOpen to avoid re-focusing on every render

  // Also focus on initial mount if isOpen is undefined (menu is just rendered)
  useEffect(() => {
    if (isOpen === undefined && focusableItems.length > 0 && focusedIndex < 0) {
      const selectedIndex = focusableItems.findIndex(({ item }) => 
        isItemSelected(item.id, currentValue)
      );
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Reset item refs array when items change
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, items.length);
  }, [items.length]);

  // Check if menu would go off-screen and adjust position (runs before paint)
  // Only apply to root menu, submenus handle their own positioning
  useLayoutEffect(() => {
    if (_depth === 0 && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const padding = 8; // Small padding from viewport edge
      
      // If menu bottom edge is below viewport, shift it up
      if (rect.bottom > viewportHeight - padding) {
        const overflow = rect.bottom - viewportHeight + padding;
        setOffsetY(-overflow);
      } else {
        setOffsetY(0);
      }

      // If menu right edge is beyond viewport, shift it left
      if (rect.right > viewportWidth - padding) {
        const overflow = rect.right - viewportWidth + padding;
        setOffsetX(-overflow);
      } else {
        setOffsetX(0);
      }
    }
  }, [isOpen, items, _depth]);

  // Cleanup timeout on unmount
  useLayoutEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // Build border class - 'future' uses global class, others use CSS module
  const borderClass =
    borderStyle === 'future'
      ? 'border-future'
      : borderStyle !== 'none'
        ? styles[`border${borderStyle.charAt(0).toUpperCase() + borderStyle.slice(1)}`]
        : undefined;

  // Handle click on menu container to enable keyboard nav
  const handleMenuClick = useCallback(() => {
    // If no item is focused yet, focus the first one
    if (focusedIndex < 0 && focusableItems.length > 0) {
      const selectedIndex = focusableItems.findIndex(({ item }) => 
        isItemSelected(item.id, currentValue)
      );
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [focusedIndex, focusableItems, currentValue]);

  return (
    <div
      ref={menuRef}
      className={clsx(
        styles.menu,
        styles[backgroundStyle],
        styles[`rounded${rounded.charAt(0).toUpperCase() + rounded.slice(1)}`],
        borderClass,
        className
      )}
      style={{ 
        width,
        transform: (_depth === 0 && (offsetX !== 0 || offsetY !== 0)) ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
      }}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleMenuKeyDown}
      onClick={handleMenuClick}
    >
      {title && <div className={styles.title}>{title}</div>}
      {items.map((item, index) => {
        if (isSeparator(item)) {
          return <hr key={`separator-${index}`} className={styles.separator} />;
        }
        
        // Find the focused index for this item in the focusable items array
        const focusableIndex = focusableItems.findIndex(f => f.index === index);
        const isFocused = focusableIndex === focusedIndex;
        
        return (
          <MenuItemComponent
            key={item.id}
            item={item}
            isSelected={isItemSelected(item.id, currentValue)}
            isFocused={isFocused}
            currentValue={currentValue}
            onSelect={handleChange}
            background={backgroundStyle}
            rounded={rounded}
            border={borderStyle}
            depth={_depth}
            isSubmenuOpen={openSubmenuId === item.id}
            onSubmenuOpen={setOpenSubmenuId}
            closeTimeoutRef={closeTimeoutRef}
            itemRef={(el) => { itemRefs.current[index] = el; }}
            onKeyDown={handleMenuKeyDown}
            onFocus={() => {
              // Sync focusedIndex when item receives focus (e.g., returning from submenu)
              if (focusableIndex >= 0 && focusableIndex !== focusedIndex) {
                setFocusedIndex(focusableIndex);
              }
            }}
          />
        );
      })}
    </div>
  );
}

Menu.displayName = 'Menu';
