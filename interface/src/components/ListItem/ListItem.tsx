import {
  useCallback,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";

import { CopyButton } from "../CopyButton";
import styles from "./ListItem.module.css";

export type ListItemProps = {
  /** DOM id stamped on the row (used by hover-delegation consumers). */
  id?: string;
  /** Primary text (or text block). Always the left-most flexible slot. */
  title: ReactNode;
  /** Muted second line rendered under the title. */
  secondary?: ReactNode;
  /** Extension slot rendered between the text block and the status slot. */
  meta?: ReactNode;
  /**
   * Right-aligned status content (icon, badge), centered in a fixed
   * 24px column so the status column lines up with the chevron column
   * across sibling rows.
   */
  status?: ReactNode;
  /** When provided, renders a copy button between status and chevron. */
  copyText?: string;
  /** Leading icon rendered before the title. */
  icon?: ReactNode;
  /** Flush-left indicator before the icon (e.g. a streaming dot). */
  leading?: ReactNode;
  /**
   * Interactive trailing slot. Clicks inside it never select the row,
   * so it can host buttons (install, more-actions) safely.
   */
  trailing?: ReactNode;
  /** Nesting depth; adds `indent` px of left padding per level. */
  depth?: number;
  /** Extra left padding in px per depth level. Defaults to 20. */
  indent?: number;
  selected?: boolean;
  disabled?: boolean;
  /**
   * Forces the chevron/collapsible treatment even when `children` is
   * empty (e.g. a folder whose children haven't loaded yet).
   */
  hasChildren?: boolean;
  /** Controlled expansion state. Omit to let the row manage its own. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSelect?: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  /** Inline-rename mode: replaces the title with a text input. */
  editing?: boolean;
  onRenameCommit?: (value: string) => void;
  onRenameCancel?: () => void;
  className?: string;
  /** Nested content (typically more `ListItem`s), collapsible via the chevron. */
  children?: ReactNode;
};

/**
 * Canonical list/tree row for aura-os. Renders the fixed slot order
 * `[leading, icon, title/secondary, meta, status, copy, chevron]` with
 * identical metrics everywhere (sidekick lists, trees, left nav). The
 * title's left edge and the chevron column share the same 12px inset
 * from the row edge. Rows nest infinitely: pass more `ListItem`s as
 * `children` and the chevron toggles an animated expand/collapse.
 */
export function ListItem({
  id,
  title,
  secondary,
  meta,
  status,
  copyText,
  icon,
  leading,
  trailing,
  depth = 0,
  indent = 20,
  selected = false,
  disabled = false,
  hasChildren,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
  onSelect,
  onMouseEnter,
  onFocus,
  editing = false,
  onRenameCommit,
  onRenameCancel,
  className,
  children,
}: ListItemProps): ReactElement {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isParent = hasChildren ?? children != null;
  const isExpanded = expanded ?? internalExpanded;

  const toggleExpanded = useCallback(() => {
    const next = !isExpanded;
    if (expanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  }, [expanded, isExpanded, onExpandedChange]);

  const handleRowClick = useCallback(() => {
    if (disabled || editing) return;
    if (onSelect) {
      onSelect();
      return;
    }
    if (isParent) toggleExpanded();
  }, [disabled, editing, onSelect, isParent, toggleExpanded]);

  const handleChevronClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!disabled) toggleExpanded();
    },
    [disabled, toggleExpanded],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled || editing) return;
      switch (event.key) {
        case "Enter":
        case " ":
          event.preventDefault();
          handleRowClick();
          break;
        case "ArrowRight":
          if (isParent && !isExpanded) {
            event.preventDefault();
            toggleExpanded();
          }
          break;
        case "ArrowLeft":
          if (isParent && isExpanded) {
            event.preventDefault();
            toggleExpanded();
          }
          break;
      }
    },
    [disabled, editing, handleRowClick, isParent, isExpanded, toggleExpanded],
  );

  const stopPropagation = useCallback((event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
  }, []);

  const indentPx = depth > 0 ? depth * indent : 0;
  const rowClassName = [
    styles.row,
    isParent && styles.rowParent,
    selected && styles.rowSelected,
    disabled && styles.rowDisabled,
    secondary != null && styles.rowMultiline,
    editing && styles.rowEditing,
  ]
    .filter(Boolean)
    .join(" ");

  const row = editing ? (
    <div
      className={rowClassName}
      style={indentPx > 0 ? { paddingLeft: 12 + indentPx } : undefined}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={isParent ? isExpanded : undefined}
    >
      {icon != null && <span className={styles.icon}>{icon}</span>}
      <ListItemRenameInput
        initialValue={typeof title === "string" ? title : ""}
        onCommit={onRenameCommit}
        onCancel={onRenameCancel}
      />
    </div>
  ) : (
    <div
      id={id}
      className={rowClassName}
      style={indentPx > 0 ? { paddingLeft: 12 + indentPx } : undefined}
      role="treeitem"
      tabIndex={disabled ? -1 : 0}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-current={selected ? "page" : undefined}
      aria-disabled={disabled || undefined}
      aria-expanded={isParent ? isExpanded : undefined}
      data-list-item=""
      data-selected={selected || undefined}
      data-parent={isParent || undefined}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
    >
      {leading != null && <span className={styles.leading}>{leading}</span>}
      {icon != null && <span className={styles.icon}>{icon}</span>}
      <span className={styles.text}>
        {/* data-inline-rename-label anchors the InlineRenameInput overlay. */}
        <span className={styles.title} data-inline-rename-label="">
          {title}
        </span>
        {secondary != null && (
          <span className={styles.secondary}>{secondary}</span>
        )}
      </span>
      {meta != null && <span className={styles.meta}>{meta}</span>}
      {status != null && <span className={styles.status}>{status}</span>}
      {copyText !== undefined && (
        <span className={styles.copy}>
          <CopyButton getText={() => copyText} iconOnly />
        </span>
      )}
      {trailing != null && (
        <span className={styles.trailing} onClick={stopPropagation}>
          {trailing}
        </span>
      )}
      {isParent && (
        <button
          type="button"
          className={styles.chevron}
          tabIndex={-1}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          title={isExpanded ? "Collapse" : "Expand"}
          disabled={disabled}
          onClick={handleChevronClick}
        >
          <ChevronRight
            size={14}
            className={`${styles.chevronIcon}${isExpanded ? ` ${styles.chevronIconExpanded}` : ""}`}
          />
        </button>
      )}
    </div>
  );

  if (!isParent) {
    return <div className={joinClassNames(styles.container, className)}>{row}</div>;
  }

  return (
    <div className={joinClassNames(styles.container, className)}>
      {row}
      <div
        className={`${styles.children}${isExpanded ? "" : ` ${styles.childrenCollapsed}`}`}
        role="group"
      >
        <div className={styles.childrenInner}>{children}</div>
      </div>
    </div>
  );
}

function joinClassNames(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

type ListItemRenameInputProps = {
  initialValue: string;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
};

function ListItemRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: ListItemRenameInputProps): ReactElement {
  const handleMount = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    // Defer focus/select so the input is visible and stable first.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }, []);

  const commitOrCancel = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || value === initialValue) {
        onCancel?.();
        return;
      }
      onCommit?.(value);
    },
    [initialValue, onCommit, onCancel],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commitOrCancel(event.currentTarget.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel?.();
      }
    },
    [commitOrCancel, onCancel],
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      commitOrCancel(event.currentTarget.value);
    },
    [commitOrCancel],
  );

  return (
    <input
      ref={handleMount}
      className={styles.renameInput}
      defaultValue={initialValue}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      spellCheck={false}
      aria-label="Rename"
    />
  );
}
