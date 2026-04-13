import { forwardRef, useCallback, type InputHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Search.module.css';

export type SearchSize = 'sm' | 'md';

export interface SearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** Size variant */
  size?: SearchSize;
  /** Custom search icon (defaults to magnifying glass) */
  icon?: ReactNode;
  /** Show clear button when input has value */
  showClear?: boolean;
  /** Callback when clear button is clicked */
  onClear?: () => void;
}

/**
 * Default search icon (magnifying glass)
 */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/**
 * Clear icon (X)
 */
function ClearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/**
 * Search - A search input component with a built-in search icon
 *
 * Designed to be easily integrated into lists like Navigator or Explorer
 * for inline filtering and search functionality.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Search
 *   placeholder="Search..."
 *   value={query}
 *   onChange={(e) => setQuery(e.target.value)}
 * />
 *
 * // With clear button
 * <Search
 *   placeholder="Filter items..."
 *   value={query}
 *   onChange={(e) => setQuery(e.target.value)}
 *   showClear
 *   onClear={() => setQuery('')}
 * />
 *
 * // Small size for inline use in lists
 * <Search
 *   size="sm"
 *   placeholder="Filter..."
 *   value={filter}
 *   onChange={(e) => setFilter(e.target.value)}
 * />
 * ```
 */
export const Search = forwardRef<HTMLInputElement, SearchProps>(
  (
    {
      size = 'md',
      icon,
      showClear = false,
      onClear,
      value,
      className,
      ...props
    },
    ref
  ) => {
    const hasValue = value !== undefined && value !== '';

    const handleClear = useCallback(() => {
      onClear?.();
    }, [onClear]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape' && hasValue && showClear) {
          e.preventDefault();
          onClear?.();
        }
        props.onKeyDown?.(e);
      },
      [hasValue, showClear, onClear, props]
    );

    return (
      <div
        className={clsx(
          styles.wrapper,
          size === 'sm' && styles.sm,
          className
        )}
      >
        <span className={styles.iconWrapper} aria-hidden="true">
          {icon ?? <SearchIcon className={styles.searchIcon} />}
        </span>
        <input
          ref={ref}
          type="search"
          className={clsx(
            styles.input,
            size === 'sm' && styles.inputSm,
            showClear && hasValue && styles.inputWithClear
          )}
          value={value}
          onKeyDown={handleKeyDown}
          aria-label={props['aria-label'] ?? props.placeholder ?? 'Search'}
          {...props}
        />
        {showClear && hasValue && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={handleClear}
            aria-label="Clear search"
          >
            <ClearIcon />
          </button>
        )}
      </div>
    );
  }
);

Search.displayName = 'Search';
