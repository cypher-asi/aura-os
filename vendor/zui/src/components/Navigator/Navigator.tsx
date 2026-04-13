import { type ReactNode, useState, useCallback, useMemo, useEffect } from 'react';
import clsx from 'clsx';
import { Item } from '../Item';
import { Search } from '../Search';
import styles from './Navigator.module.css';

export interface NavigatorItemProps {
  /** Unique identifier for the item */
  id: string;
  /** The text label to display */
  label: string;
  /** Optional icon to display on the left */
  icon?: ReactNode;
  /** Whether this item is disabled */
  disabled?: boolean;
}

export interface NavigatorProps {
  /** Array of navigation items */
  items: NavigatorItemProps[];
  /** Currently active item id */
  value?: string;
  /** Callback when selection changes */
  onChange?: (id: string) => void;
  /** Additional CSS class name */
  className?: string;
  /** Whether to show inline search input (default: false) */
  searchable?: boolean;
  /** Placeholder text for search input */
  searchPlaceholder?: string;
  /** Callback when search query changes */
  onSearch?: (query: string) => void;
}

/**
 * Highlight matching text in a label
 */
function HighlightedLabel({ label, query }: { label: string; query: string }) {
  if (!query.trim()) return <>{label}</>;

  const lowerLabel = label.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerLabel.indexOf(lowerQuery);

  if (index === -1) return <>{label}</>;

  const before = label.slice(0, index);
  const match = label.slice(index, index + query.length);
  const after = label.slice(index + query.length);

  return (
    <>
      {before}
      <mark className={styles.highlight}>{match}</mark>
      {after}
    </>
  );
}

/**
 * Navigator - A navigation list component using the unified Item component
 *
 * Provides consistent padding, spacing, and layout for navigation sections.
 * Uses the same Item component as Menu and Explorer for consistency.
 *
 * @example
 * ```tsx
 * <Navigator
 *   items={[
 *     { id: 'home', label: 'Home', icon: <Home /> },
 *     { id: 'settings', label: 'Settings', icon: <Settings /> },
 *   ]}
 *   value={activeId}
 *   onChange={setActiveId}
 * />
 *
 * // With inline search
 * <Navigator
 *   items={items}
 *   value={activeId}
 *   onChange={setActiveId}
 *   searchable
 *   searchPlaceholder="Filter..."
 * />
 * ```
 */
export function Navigator({
  items,
  value,
  onChange,
  className,
  searchable = false,
  searchPlaceholder,
  onSearch,
}: NavigatorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);
      onSearch?.(query);
    },
    [onSearch]
  );

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
    setFocusedId(null);
    onSearch?.('');
  }, [onSearch]);

  const handleItemClick = (item: NavigatorItemProps) => {
    if (!item.disabled && onChange) {
      onChange(item.id);
    }
  };

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const lowerQuery = searchQuery.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lowerQuery));
  }, [items, searchQuery]);

  // Reset focused ID when search changes
  useEffect(() => {
    if (searchQuery.trim() && filteredItems.length > 0) {
      setFocusedId(filteredItems[0].id);
    } else {
      setFocusedId(null);
    }
  }, [searchQuery, filteredItems.length]);

  // Move focus up or down
  const moveFocus = useCallback(
    (direction: 'up' | 'down') => {
      if (filteredItems.length === 0) return;

      const currentIndex = focusedId ? filteredItems.findIndex((item) => item.id === focusedId) : -1;
      let nextIndex: number;

      if (direction === 'down') {
        nextIndex = currentIndex < filteredItems.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredItems.length - 1;
      }

      setFocusedId(filteredItems[nextIndex].id);
    },
    [focusedId, filteredItems]
  );

  // Select the focused item
  const selectFocused = useCallback(() => {
    if (focusedId && onChange) {
      const item = filteredItems.find((i) => i.id === focusedId);
      if (item && !item.disabled) {
        onChange(focusedId);
      }
    }
  }, [focusedId, filteredItems, onChange]);

  // Handle keyboard events on search
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveFocus('down');
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus('up');
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedId) {
            selectFocused();
            setSearchQuery('');
            setFocusedId(null);
            onSearch?.('');
          }
          break;
      }
    },
    [moveFocus, selectFocused, focusedId, onSearch]
  );

  return (
    <nav className={clsx(styles.navigator, className)} role="navigation">
      {searchable && (
        <div className={styles.searchContainer}>
          <Search
            size="sm"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            showClear
            onClear={handleSearchClear}
          />
        </div>
      )}
      <div className={styles.items}>
        {filteredItems.length === 0 && searchQuery.trim() && (
          <div className={styles.noResults}>No matches found</div>
        )}
        {filteredItems.map((item) => (
          <Item
            key={item.id}
            id={item.id}
            className={clsx(
              styles.navigatorItem,
              value === item.id && styles.active,
              item.disabled && styles.disabled,
              focusedId === item.id && styles.focused
            )}
            active={value === item.id}
            disabled={item.disabled}
            onClick={() => handleItemClick(item)}
          >
            {item.icon && <Item.Icon className={styles.icon}>{item.icon}</Item.Icon>}
            <Item.Label className={styles.label}>
              <HighlightedLabel label={item.label} query={searchQuery} />
            </Item.Label>
          </Item>
        ))}
      </div>
    </nav>
  );
}
