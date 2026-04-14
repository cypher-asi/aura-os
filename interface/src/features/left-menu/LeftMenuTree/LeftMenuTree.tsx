import {
  useRef,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type RefObject,
} from "react";
import { ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useOverlayScrollbar } from "../../../hooks/use-overlay-scrollbar";
import type {
  LeftMenuEmptyEntry,
  LeftMenuEntry,
  LeftMenuGroupEntry,
  LeftMenuLeafEntry,
} from "../types";
import styles from "./LeftMenuTree.module.css";

interface LeftMenuTreeProps {
  ariaLabel: string;
  entries: LeftMenuEntry[];
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

const ROW_HEIGHT = 28;
const VIRTUALIZE_AFTER = 30;

function getVisibleRowCount(entry: LeftMenuEntry): number {
  if (entry.kind === "item") {
    return 1;
  }

  if (!entry.expanded) {
    return 1;
  }

  const childRows = entry.emptyState
    ? 1
    : entry.children.reduce((total, child) => total + getVisibleRowCount(child), 0);
  return 1 + childRows;
}

function getEntryHeight(entry: LeftMenuEntry): number {
  return getVisibleRowCount(entry) * ROW_HEIGHT;
}

function LeftMenuEmptyStateRow({ entry }: { entry: LeftMenuEmptyEntry }) {
  return (
    <div className={styles.emptyAgentsState} data-testid={entry.testId}>
      <span className={styles.emptyAgentsDash} aria-hidden="true">
        {entry.icon ?? "-"}
      </span>
      <span className={styles.emptyAgentsLabel}>{entry.label}</span>
    </div>
  );
}

function LeftMenuLeafRow({
  entry,
  depth,
}: {
  entry: LeftMenuLeafEntry;
  depth: number;
}) {
  const className = [
    styles.agentRow,
    depth === 0 ? styles.rootItemRow : "",
    entry.selected ? styles.agentRowSelected : "",
    entry.disabled ? styles.agentRowDisabled : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      id={entry.id}
      type="button"
      className={className}
      aria-selected={entry.selected}
      disabled={entry.disabled}
      data-testid={entry.testId}
      onClick={entry.disabled ? undefined : entry.onSelect}
      style={{ paddingLeft: 16 + Math.max(depth - 1, 0) * 16 }}
    >
      {entry.icon ? <span className={styles.agentIcon}>{entry.icon}</span> : null}
      <span className={styles.agentLabel} data-inline-rename-label>
        {entry.label}
      </span>
      {entry.suffix ? <span className={styles.agentSuffix}>{entry.suffix}</span> : null}
    </button>
  );
}

function LeftMenuGroup({
  entry,
  depth,
}: {
  entry: LeftMenuGroupEntry;
  depth: number;
}) {
  const isSection = entry.variant === "section";
  const headerClassName = [
    isSection ? styles.sectionHeader : styles.projectHeader,
    entry.selected ? styles.projectHeaderSelected : "",
  ]
    .filter(Boolean)
    .join(" ");
  const buttonClassName = [
    isSection ? styles.sectionMainButton : styles.projectMainButton,
    entry.selected ? styles.projectMainButtonSelected : "",
  ]
    .filter(Boolean)
    .join(" ");
  const handleChevronClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (entry.toggleMode !== "secondary" || !entry.onToggle) return;
    event.preventDefault();
    event.stopPropagation();
    entry.onToggle();
  };
  const handleProjectKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (entry.toggleMode !== "secondary" || !entry.onToggle) return;
    if (event.key === "ArrowRight" && !entry.expanded) {
      event.preventDefault();
      entry.onToggle();
      return;
    }
    if (event.key === "ArrowLeft" && entry.expanded) {
      event.preventDefault();
      entry.onToggle();
    }
  };

  return (
    <section className={isSection ? styles.sectionGroup : styles.projectGroup}>
      <div
        className={headerClassName}
        style={{ paddingLeft: 16 + depth * 16 }}
      >
        <button
          id={entry.id}
          type="button"
          className={buttonClassName}
          aria-expanded={entry.expanded}
          aria-selected={entry.selected ?? false}
          data-testid={entry.testId}
          onClick={entry.onActivate}
          onKeyDown={handleProjectKeyDown}
        >
          <span
            className={isSection ? styles.sectionLabel : styles.projectLabel}
            data-inline-rename-label
          >
            {entry.label}
          </span>
          <span
            className={`${styles.projectChevronWrap} ${isSection ? styles.sectionChevronWrap : ""} ${entry.toggleMode === "secondary" ? styles.projectChevronWrapInteractive : ""}`}
            aria-hidden="true"
            onClick={handleChevronClick}
          >
            <ChevronRight
              size={14}
              className={`${styles.projectChevron} ${entry.expanded ? styles.projectChevronExpanded : ""}`}
            />
          </span>
        </button>
        {entry.suffix ? <span className={styles.projectActions}>{entry.suffix}</span> : null}
      </div>
      {entry.expanded ? (
        <div className={styles.childrenList} role="group">
          {entry.emptyState ? (
            <LeftMenuEmptyStateRow entry={entry.emptyState} />
          ) : (
            entry.children.map((childEntry) => (
              <LeftMenuEntryRow key={childEntry.id} entry={childEntry} depth={depth + 1} />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function LeftMenuEntryRow({
  entry,
  depth = 0,
}: {
  entry: LeftMenuEntry;
  depth?: number;
}) {
  return entry.kind === "group" ? (
    <LeftMenuGroup entry={entry} depth={depth} />
  ) : (
    <LeftMenuLeafRow entry={entry} depth={depth} />
  );
}

function StaticEntries({
  ariaLabel,
  entries,
}: {
  ariaLabel: string;
  entries: LeftMenuEntry[];
}) {
  return (
    <div className={styles.entriesList} role="tree" aria-label={ariaLabel}>
      {entries.map((entry) => (
        <LeftMenuEntryRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function VirtualizedEntries({
  ariaLabel,
  entries,
  scrollRef,
}: {
  ariaLabel: string;
  entries: LeftMenuEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    initialRect: { width: 0, height: 480 },
    estimateSize: (index) => {
      const entry = entries[index];
      return entry ? getEntryHeight(entry) : ROW_HEIGHT;
    },
    getItemKey: (index) => entries[index]?.id ?? index,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();

  if (virtualItems.length === 0) {
    return <StaticEntries ariaLabel={ariaLabel} entries={entries} />;
  }

  return (
    <div className={styles.entriesList} role="tree" aria-label={ariaLabel}>
      <div
        className={styles.virtualListContainer}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((item) => {
          const entry = entries[item.index];
          if (!entry) return null;
          return (
            <div
              key={entry.id}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={styles.virtualRow}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <LeftMenuEntryRow entry={entry} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LeftMenuTree({
  ariaLabel,
  entries,
  onContextMenu,
  onKeyDown,
}: LeftMenuTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { thumbStyle, visible, onThumbPointerDown } = useOverlayScrollbar(scrollRef);
  const shouldVirtualize = entries.length > VIRTUALIZE_AFTER;

  return (
    <div className={styles.root}>
      <div
        ref={scrollRef}
        className={styles.explorerWrap}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        {shouldVirtualize ? (
          <VirtualizedEntries ariaLabel={ariaLabel} entries={entries} scrollRef={scrollRef} />
        ) : (
          <StaticEntries ariaLabel={ariaLabel} entries={entries} />
        )}
      </div>
      <div className={styles.scrollTrack}>
        <div
          className={`${styles.scrollThumb} ${visible ? styles.scrollThumbVisible : ""}`}
          style={thumbStyle}
          onPointerDown={onThumbPointerDown}
        />
      </div>
    </div>
  );
}
