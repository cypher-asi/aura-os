import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { EmptyState } from "../EmptyState";
import { ListItem } from "../ListItem";
import { SidekickCollapsibleRow } from "../SidekickCollapsibleRow";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
  type SidekickMenuAction,
} from "../SidekickItemContextMenu";
import styles from "./SidekickList.module.css";

/**
 * A single selectable row in a {@link SidekickList}. Built on the shared
 * `ListItem` primitive (the same one the Plans / Tasks / Files trees use)
 * so every list reads with identical metrics and hover/selected treatment.
 */
export interface SidekickListRow {
  /** Stable unique id; also used to resolve the right-click context menu. */
  id: string;
  /** Primary text. */
  label: ReactNode;
  /** Optional secondary line rendered under the label. */
  detail?: ReactNode;
  /** Optional leading icon (rendered after the indicator, before the text). */
  icon?: ReactNode;
  /** Optional indicator rendered flush to the row's left edge (e.g. a streaming dot). */
  leadingIndicator?: ReactNode;
  /** Optional non-interactive right-aligned content inside the row (badge, status). */
  suffix?: ReactNode;
  /**
   * Optional interactive control rendered as a sibling of the row button
   * (e.g. an install button or a "more actions" menu). Kept outside the
   * row `<button>` so it stays valid, focusable, and independently
   * clickable.
   */
  trailingAction?: ReactNode;
  disabled?: boolean;
  /** Per-row click handler. Falls back to the list-level `onSelectRow`. */
  onSelect?: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  /**
   * Fired when the row enters/leaves the viewport. When provided the row
   * wires up an `IntersectionObserver` - used by the Chats list to gate
   * its lazy summary backfill to on-screen rows only.
   */
  onVisibilityChange?: (visible: boolean) => void;
}

/**
 * A group of rows. When `label` is provided the section renders a
 * collapsible header (matching the Plans / Tasks parent-row treatment);
 * otherwise the rows render flush as a flat list.
 */
export interface SidekickListSection {
  id: string;
  label?: ReactNode;
  rows: SidekickListRow[];
  /** Whether the section starts expanded. Defaults to `true`. */
  defaultExpanded?: boolean;
  /** Copy shown (muted) when the section has no rows but is expanded. */
  emptyLabel?: ReactNode;
}

export interface SidekickListProps {
  sections: SidekickListSection[];
  /** Currently selected row id (single selection across all sections). */
  selectedId?: string | null;
  /** Fallback row click handler when a row has no `onSelect`. */
  onSelectRow?: (id: string) => void;
  loading?: boolean;
  /** Copy shown while loading with no rows yet. Defaults to "Loading...". */
  loadingLabel?: ReactNode;
  /** Whole-list empty state, shown when every section is empty. */
  empty?: ReactNode;
  /** Context-menu actions enabled per row. Omit to disable the menu. */
  menuActions?: SidekickMenuAction[];
  /** Fired when a context-menu action is chosen for a given row id. */
  onMenuAction?: (actionId: string, rowId: string) => void;
  className?: string;
}

interface SidekickListItemProps {
  row: SidekickListRow;
  selected: boolean;
  onSelectRow?: (id: string) => void;
}

function SidekickListItem({
  row,
  selected,
  onSelectRow,
}: SidekickListItemProps): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { onVisibilityChange } = row;

  useEffect(() => {
    if (!onVisibilityChange) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisibilityChange(true);
      return;
    }
    const target = wrapRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onVisibilityChange(entry.isIntersecting);
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [onVisibilityChange]);

  const handleClick = useCallback(() => {
    if (row.onSelect) {
      row.onSelect();
      return;
    }
    onSelectRow?.(row.id);
  }, [row, onSelectRow]);

  return (
    <div ref={wrapRef}>
      <ListItem
        id={row.id}
        title={row.label}
        secondary={row.detail}
        icon={row.icon}
        leading={row.leadingIndicator}
        status={row.suffix}
        trailing={row.trailingAction}
        selected={selected}
        disabled={row.disabled}
        onSelect={handleClick}
        onMouseEnter={row.onMouseEnter}
        onFocus={row.onFocus}
      />
    </div>
  );
}

interface SidekickListSectionViewProps {
  section: SidekickListSection;
  selectedId?: string | null;
  onSelectRow?: (id: string) => void;
}

function SidekickListSectionView({
  section,
  selectedId,
  onSelectRow,
}: SidekickListSectionViewProps): ReactElement {
  const [expanded, setExpanded] = useState(section.defaultExpanded ?? true);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const rows = (
    <div className={styles.sectionBody}>
      {section.rows.length === 0
        ? section.emptyLabel != null && (
            <div className={styles.sectionEmpty}>{section.emptyLabel}</div>
          )
        : section.rows.map((row) => (
            <SidekickListItem
              key={row.id}
              row={row}
              selected={selectedId === row.id}
              onSelectRow={onSelectRow}
            />
          ))}
    </div>
  );

  if (section.label == null) {
    return <div className={styles.section}>{rows}</div>;
  }

  return (
    <div className={styles.section}>
      <SidekickCollapsibleRow expanded={expanded} onToggle={toggle} label={section.label}>
        {rows}
      </SidekickCollapsibleRow>
    </div>
  );
}

/**
 * Canonical sidekick list. Renders one or more (optionally collapsible)
 * sections of selectable rows, with a single parent-controlled selection
 * across every section, a shared right-click context menu, and built-in
 * loading / empty states. Used by the agents and projects sidekicks so
 * Chats, Skills, Memory, project bindings, permissions, sessions, and the
 * log all read identically to the Plans / Tasks lists.
 */
export function SidekickList({
  sections,
  selectedId,
  onSelectRow,
  loading,
  loadingLabel = "Loading...",
  empty,
  menuActions,
  onMenuAction,
  className,
}: SidekickListProps): ReactElement {
  const rowsById = useMemo(() => {
    const map = new Map<string, SidekickListRow>();
    for (const section of sections) {
      for (const row of section.rows) map.set(row.id, row);
    }
    return map;
  }, [sections]);

  const resolveItem = useCallback(
    (nodeId: string): SidekickListRow | null => rowsById.get(nodeId) ?? null,
    [rowsById],
  );
  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu<SidekickListRow>({ resolveItem });

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (target) onMenuAction?.(actionId, target.id);
    },
    [menu, closeMenu, onMenuAction],
  );

  const totalRows = rowsById.size;
  const menuEnabled = !!menuActions && menuActions.length > 0 && !!onMenuAction;

  if (loading && totalRows === 0) {
    return <div className={styles.loading}>{loadingLabel}</div>;
  }

  // Whole-list empty/fallback only when the caller hasn't modelled the
  // empty case as labelled sections (each of which renders its own
  // `emptyLabel`). This lets multi-section lists (e.g. Skills) keep their
  // section headers visible while single-purpose lists show one message.
  if (totalRows === 0) {
    if (empty != null) return <>{empty}</>;
    const hasSectionEmptyCopy = sections.some(
      (section) => section.label != null || section.emptyLabel != null,
    );
    if (!hasSectionEmptyCopy) return <EmptyState>No items yet</EmptyState>;
  }

  return (
    <>
      <div
        className={`${styles.list}${className ? ` ${className}` : ""}`}
        role="tree"
        onContextMenu={menuEnabled ? handleContextMenu : undefined}
      >
        {sections.map((section) => (
          <SidekickListSectionView
            key={section.id}
            section={section}
            selectedId={selectedId}
            onSelectRow={onSelectRow}
          />
        ))}
      </div>
      {menuEnabled && menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
          actions={menuActions}
        />
      )}
    </>
  );
}
