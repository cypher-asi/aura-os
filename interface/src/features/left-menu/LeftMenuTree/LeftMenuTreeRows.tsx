import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronRight } from "lucide-react";
import type {
  LeftMenuEmptyEntry,
  LeftMenuEntry,
  LeftMenuGroupEntry,
  LeftMenuLeafEntry,
} from "../types";
import styles from "./LeftMenuTree.module.css";

export type RootReorderState = {
  activeId: string | null;
  draggableIds: ReadonlySet<string>;
  onActivate: (entryId: string, activate: () => void) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, entryId: string) => void;
};

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
  rootReorderState,
}: {
  entry: LeftMenuGroupEntry;
  depth: number;
  rootReorderState?: RootReorderState;
}) {
  const isSection = entry.variant === "section";
  const isRootDraggable =
    depth === 0 && !isSection && rootReorderState?.draggableIds.has(entry.id);
  const headerClassName = [
    isSection ? styles.sectionHeader : styles.projectHeader,
    entry.selected ? styles.projectHeaderSelected : "",
    isRootDraggable ? styles.projectHeaderDraggable : "",
    rootReorderState?.activeId === entry.id ? styles.projectHeaderDragging : "",
  ]
    .filter(Boolean)
    .join(" ");
  const buttonClassName = [
    isSection ? styles.sectionMainButton : styles.projectMainButton,
    entry.selected ? styles.projectMainButtonSelected : "",
    isRootDraggable ? styles.projectMainButtonDraggable : "",
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
  const handleButtonClick = () => {
    if (isRootDraggable) {
      rootReorderState?.onActivate(entry.id, entry.onActivate);
      return;
    }
    entry.onActivate();
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isRootDraggable) return;
    rootReorderState?.onPointerDown(event, entry.id);
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
          data-left-menu-root-entry-id={isRootDraggable ? entry.id : undefined}
          onClick={handleButtonClick}
          onKeyDown={handleProjectKeyDown}
          onPointerDown={handlePointerDown}
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
            data-left-menu-drag-ignore="true"
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

export function LeftMenuEntryRow({
  entry,
  depth = 0,
  rootReorderState,
}: {
  entry: LeftMenuEntry;
  depth?: number;
  rootReorderState?: RootReorderState;
}) {
  return entry.kind === "group" ? (
    <LeftMenuGroup entry={entry} depth={depth} rootReorderState={rootReorderState} />
  ) : (
    <LeftMenuLeafRow entry={entry} depth={depth} />
  );
}

export function StaticEntries({
  ariaLabel,
  entries,
  rootReorderState,
}: {
  ariaLabel: string;
  entries: LeftMenuEntry[];
  rootReorderState?: RootReorderState;
}) {
  return (
    <div className={styles.entriesList} role="tree" aria-label={ariaLabel}>
      {entries.map((entry) => (
        <LeftMenuEntryRow
          key={entry.id}
          entry={entry}
          rootReorderState={rootReorderState}
        />
      ))}
    </div>
  );
}
