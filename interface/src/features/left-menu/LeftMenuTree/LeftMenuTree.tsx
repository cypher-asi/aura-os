import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useOverlayScrollbar } from "../../../shared/hooks/use-overlay-scrollbar";
import type { LeftMenuEntry, LeftMenuGroupEntry } from "../types";
import {
  LeftMenuEntryRow,
  StaticEntries,
  type RootReorderState,
} from "./LeftMenuTreeRows";
import styles from "./LeftMenuTree.module.css";

interface LeftMenuTreeProps {
  ariaLabel: string;
  entries: LeftMenuEntry[];
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  rootReorder?: {
    draggableEntryIds: string[];
    onReorder: (orderedIds: string[]) => void;
  };
}

const ROW_HEIGHT = 28;
const VIRTUALIZE_AFTER = 30;
const DRAG_START_THRESHOLD_PX = 6;

type RootButtonRect = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerY: number;
};

type RootDragState = {
  activeId: string;
  activeVisibleIndex: number;
  buttonRects: RootButtonRect[];
  overlayRect: { left: number; top: number; width: number; height: number };
  pointerDeltaY: number;
  targetVisibleIndex: number;
  rootIds: string[];
  visibleIds: string[];
};

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

function getTargetVisibleIndex(
  buttonRects: RootButtonRect[],
  activeId: string,
  draggedCenterY: number,
): number {
  return buttonRects.reduce((count, rect) => {
    if (rect.id === activeId) return count;
    return count + (draggedCenterY > rect.centerY ? 1 : 0);
  }, 0);
}

function moveVisibleEntryOrder(
  fullOrder: string[],
  visibleIds: string[],
  activeId: string,
  targetVisibleIndex: number,
): string[] {
  const withoutActive = fullOrder.filter((id) => id !== activeId);
  const visibleWithoutActive = visibleIds.filter((id) => id !== activeId);
  const beforeId = visibleWithoutActive[targetVisibleIndex] ?? null;

  if (!beforeId) {
    return [...withoutActive, activeId];
  }

  const insertIndex = withoutActive.indexOf(beforeId);
  if (insertIndex === -1) {
    return fullOrder;
  }

  return [
    ...withoutActive.slice(0, insertIndex),
    activeId,
    ...withoutActive.slice(insertIndex),
  ];
}

function reorderTopLevelEntries(entries: LeftMenuEntry[], orderedIds: string[]): LeftMenuEntry[] {
  if (orderedIds.length === 0) {
    return entries;
  }

  const orderedIdSet = new Set(orderedIds);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const orderedEntries = orderedIds
    .map((id) => entryMap.get(id))
    .filter((entry): entry is LeftMenuEntry => entry !== undefined);
  const nextEntries: LeftMenuEntry[] = [];
  let insertedOrderedEntries = false;

  for (const entry of entries) {
    if (orderedIdSet.has(entry.id)) {
      if (!insertedOrderedEntries) {
        nextEntries.push(...orderedEntries);
        insertedOrderedEntries = true;
      }
      continue;
    }
    nextEntries.push(entry);
  }

  return nextEntries;
}

function getRenderedRootButtonRects(
  container: HTMLDivElement | null,
  draggableIds: ReadonlySet<string>,
): RootButtonRect[] {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-left-menu-root-entry-id]"),
  )
    .map((button) => {
      const id = button.dataset.leftMenuRootEntryId;
      if (!id || !draggableIds.has(id)) return null;
      const rect = button.getBoundingClientRect();
      return {
        id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        centerY: rect.top + rect.height / 2,
      } satisfies RootButtonRect;
    })
    .filter((rect): rect is RootButtonRect => rect !== null);
}

function VirtualizedEntries({
  ariaLabel,
  entries,
  scrollRef,
  rootReorderState,
}: {
  ariaLabel: string;
  entries: LeftMenuEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  rootReorderState?: RootReorderState;
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
    return (
      <StaticEntries
        ariaLabel={ariaLabel}
        entries={entries}
        rootReorderState={rootReorderState}
      />
    );
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
              <LeftMenuEntryRow entry={entry} rootReorderState={rootReorderState} />
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
  rootReorder,
}: LeftMenuTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { thumbStyle, visible, onThumbPointerDown } = useOverlayScrollbar(scrollRef);
  const shouldVirtualize = entries.length > VIRTUALIZE_AFTER;
  const [dragState, setDragState] = useState<RootDragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const draggableRootIds = useMemo(
    () => rootReorder?.draggableEntryIds ?? [],
    [rootReorder?.draggableEntryIds],
  );
  const draggableRootIdSet = useMemo(() => new Set(draggableRootIds), [draggableRootIds]);
  const displayEntries = useMemo(() => {
    if (!dragState) {
      return entries;
    }
    const nextOrder = moveVisibleEntryOrder(
      dragState.rootIds,
      dragState.visibleIds,
      dragState.activeId,
      dragState.targetVisibleIndex,
    );
    return reorderTopLevelEntries(entries, nextOrder);
  }, [dragState, entries]);
  const activeDraggedEntry = useMemo(
    () =>
      entries.find(
        (entry): entry is LeftMenuGroupEntry =>
          entry.kind === "group" && entry.id === dragState?.activeId,
      ) ?? null,
    [dragState?.activeId, entries],
  );

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const handleRootActivate = (entryId: string, activate: () => void) => {
    if (suppressClickRef.current === entryId) {
      suppressClickRef.current = null;
      return;
    }
    suppressClickRef.current = null;
    activate();
  };

  const handleRootPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    entryId: string,
  ) => {
    if (!rootReorder || event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-left-menu-drag-ignore='true']")
    ) {
      return;
    }

    dragCleanupRef.current?.();
    setDragState(null);

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const buttonRects = getRenderedRootButtonRects(scrollRef.current, draggableRootIdSet);
    const activeVisibleIndex = buttonRects.findIndex((rect) => rect.id === entryId);
    const activeRect = buttonRects[activeVisibleIndex];
    let dragging = false;
    let latestTargetVisibleIndex = activeVisibleIndex;
    let pointerCaptured = false;

    if (!activeRect || activeVisibleIndex === -1) {
      return;
    }

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      if (
        pointerCaptured &&
        typeof target.releasePointerCapture === "function" &&
        typeof target.hasPointerCapture === "function" &&
        target.hasPointerCapture(pointerId)
      ) {
        target.releasePointerCapture(pointerId);
      }
      dragCleanupRef.current = null;
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;

      const pointerDeltaY = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.abs(pointerDeltaY) < DRAG_START_THRESHOLD_PX) return;
        dragging = true;
        if (typeof target.setPointerCapture === "function") {
          target.setPointerCapture(pointerId);
          pointerCaptured = true;
        }
      }

      moveEvent.preventDefault();
      latestTargetVisibleIndex = getTargetVisibleIndex(
        buttonRects,
        entryId,
        activeRect.centerY + pointerDeltaY,
      );
      setDragState({
        activeId: entryId,
        activeVisibleIndex,
        buttonRects,
        overlayRect: {
          left: activeRect.left,
          top: activeRect.top,
          width: activeRect.width,
          height: activeRect.height,
        },
        pointerDeltaY,
        targetVisibleIndex: latestTargetVisibleIndex,
        rootIds: draggableRootIds,
        visibleIds: buttonRects.map((rect) => rect.id),
      });
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;

      cleanup();
      if (dragging) {
        const nextOrder = moveVisibleEntryOrder(
          draggableRootIds,
          buttonRects.map((rect) => rect.id),
          entryId,
          latestTargetVisibleIndex,
        );
        suppressClickRef.current = entryId;
        if (nextOrder.join("|") !== draggableRootIds.join("|")) {
          rootReorder.onReorder(nextOrder);
        }
      }

      setDragState(null);
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
  };

  const rootReorderState = rootReorder
    ? {
        activeId: dragState?.activeId ?? null,
        draggableIds: draggableRootIdSet,
        onActivate: handleRootActivate,
        onPointerDown: handleRootPointerDown,
      }
    : undefined;

  return (
    <div className={styles.root}>
      <div
        ref={scrollRef}
        className={styles.explorerWrap}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        {shouldVirtualize ? (
          <VirtualizedEntries
            ariaLabel={ariaLabel}
            entries={displayEntries}
            scrollRef={scrollRef}
            rootReorderState={rootReorderState}
          />
        ) : (
          <StaticEntries
            ariaLabel={ariaLabel}
            entries={displayEntries}
            rootReorderState={rootReorderState}
          />
        )}
      </div>
      <div className={styles.scrollTrack}>
        <div
          className={`${styles.scrollThumb} ${visible ? styles.scrollThumbVisible : ""}`}
          style={thumbStyle}
          onPointerDown={onThumbPointerDown}
        />
      </div>
      {dragState && activeDraggedEntry && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.projectDragOverlay}
              style={{
                left: dragState.overlayRect.left,
                top: dragState.overlayRect.top + dragState.pointerDeltaY,
                width: dragState.overlayRect.width,
              }}
            >
              <div
                className={`${styles.projectDragOverlayInner} ${activeDraggedEntry.selected ? styles.projectHeaderSelected : ""}`}
              >
                <span
                  className={`${styles.projectLabel} ${activeDraggedEntry.selected ? styles.projectMainButtonSelected : ""}`}
                >
                  {activeDraggedEntry.label}
                </span>
                <ChevronRight
                  size={14}
                  className={`${styles.projectChevron} ${activeDraggedEntry.expanded ? styles.projectChevronExpanded : ""}`}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
