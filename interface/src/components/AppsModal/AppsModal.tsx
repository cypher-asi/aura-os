import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@cypher-asi/zui";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getOrderedTaskbarApps, useAppStore } from "../../stores/app-store";
import styles from "./AppsModal.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type SectionId = "visible" | "hidden";

interface AppRowData {
  id: string;
  label: string;
  Icon: LucideIcon;
}

export function AppsModal({ isOpen, onClose }: Props) {
  const apps = useAppStore((s) => s.apps);
  const taskbarAppOrder = useAppStore((s) => s.taskbarAppOrder);
  const taskbarHiddenAppIds = useAppStore((s) => s.taskbarHiddenAppIds);
  const saveTaskbarAppsLayout = useAppStore((s) => s.saveTaskbarAppsLayout);

  const [activeId, setActiveId] = useState<string | null>(null);

  // Reorderable (non-pinned) apps sorted by the stored taskbar order. Pinned
  // apps (desktop, profile) are excluded from this modal; they live outside
  // the reorderable strip and are always visible.
  const rows = useMemo<AppRowData[]>(() => {
    const ordered = getOrderedTaskbarApps(apps, taskbarAppOrder);
    return ordered
      .filter((app) => app.id !== "desktop" && app.id !== "profile")
      .map((app) => ({ id: app.id, label: app.label, Icon: app.icon }));
  }, [apps, taskbarAppOrder]);

  const hiddenSet = useMemo(
    () => new Set(taskbarHiddenAppIds),
    [taskbarHiddenAppIds],
  );

  const visibleRows = useMemo(
    () => rows.filter((row) => !hiddenSet.has(row.id)),
    [rows, hiddenSet],
  );
  const hiddenRows = useMemo(
    () => rows.filter((row) => hiddenSet.has(row.id)),
    [rows, hiddenSet],
  );

  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findSection = useCallback(
    (id: string | null): SectionId | null => {
      if (!id) return null;
      if (id === "visible" || id === "hidden") return id;
      if (!rowsById.has(id)) return null;
      return hiddenSet.has(id) ? "hidden" : "visible";
    },
    [hiddenSet, rowsById],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const activeItemId = String(active.id);
      const overId = String(over.id);
      if (activeItemId === overId) return;

      const activeSection = findSection(activeItemId);
      const targetSection = findSection(overId);
      if (!activeSection || !targetSection) return;

      // Compute the new arrangement from the current snapshot and commit it
      // atomically on drop. Committing only on drop (not during onDragOver)
      // keeps the source element in the DOM during drag, so the DragOverlay
      // activator rect stays stable and the ghost tracks the cursor cleanly.
      const visibleIds = rows
        .filter((row) => !hiddenSet.has(row.id))
        .map((row) => row.id);
      const hiddenIds = rows
        .filter((row) => hiddenSet.has(row.id))
        .map((row) => row.id);

      const sourceIds = activeSection === "visible" ? visibleIds : hiddenIds;
      const fromIndex = sourceIds.indexOf(activeItemId);
      if (fromIndex === -1) return;
      const withoutActive = [
        ...sourceIds.slice(0, fromIndex),
        ...sourceIds.slice(fromIndex + 1),
      ];

      let nextVisibleIds =
        activeSection === "visible" ? withoutActive : visibleIds;
      let nextHiddenIds =
        activeSection === "hidden" ? withoutActive : hiddenIds;

      const targetList =
        targetSection === "visible" ? nextVisibleIds : nextHiddenIds;
      let insertIndex: number;
      if (overId === "visible" || overId === "hidden") {
        insertIndex = targetList.length;
      } else {
        const overIndex = targetList.indexOf(overId);
        insertIndex = overIndex === -1 ? targetList.length : overIndex;
      }

      const nextTargetList = [
        ...targetList.slice(0, insertIndex),
        activeItemId,
        ...targetList.slice(insertIndex),
      ];

      if (targetSection === "visible") nextVisibleIds = nextTargetList;
      else nextHiddenIds = nextTargetList;

      const order = [...nextVisibleIds, ...nextHiddenIds];
      saveTaskbarAppsLayout(order, nextHiddenIds);
    },
    [findSection, hiddenSet, rows, saveTaskbarAppsLayout],
  );

  const activeRow = activeId ? rowsById.get(activeId) ?? null : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Apps"
      size="sm"
      compactHeader
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <AppSection
          id="visible"
          title="Visible in taskbar"
          rows={visibleRows}
          emptyLabel="No apps. Drag items here to show them in the taskbar."
        />
        <AppSection
          id="hidden"
          title="Hidden"
          rows={hiddenRows}
          emptyLabel="No hidden apps. Drag items here to hide them from the taskbar."
        />
        {/*
          Portal the overlay to document.body so it escapes the modal's
          transform ancestor (the ZUI Modal applies `transform: scale(1)` via
          its scale-in animation with fill-mode forwards). Without this portal,
          `position: fixed` on the DragOverlay would be anchored to the modal
          instead of the viewport, which makes the ghost visually offset from
          the pointer.
        */}
        {typeof document !== "undefined"
          ? createPortal(
              <DragOverlay dropAnimation={null} style={{ zIndex: 2000 }}>
                {activeRow ? <AppRow row={activeRow} isOverlay /> : null}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>
    </Modal>
  );
}

interface AppSectionProps {
  id: SectionId;
  title: string;
  rows: AppRowData[];
  emptyLabel: string;
}

function AppSection({ id, title, rows, emptyLabel }: AppSectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const sectionCls = [styles.section, isOver ? styles.sectionOver : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={sectionCls} aria-labelledby={`apps-modal-${id}-heading`}>
      <header className={styles.sectionHeader}>
        <h3 id={`apps-modal-${id}-heading`} className={styles.sectionTitle}>
          {title}
        </h3>
        {id === "hidden" ? <EyeOff size={12} aria-hidden="true" /> : null}
      </header>
      <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={styles.list}
          data-section={id}
          role="list"
        >
          {rows.length === 0 ? (
            <div className={styles.empty} role="listitem" aria-live="polite">
              {emptyLabel}
            </div>
          ) : (
            rows.map((row) => <SortableAppRow key={row.id} row={row} />)
          )}
        </div>
      </SortableContext>
    </section>
  );
}

interface SortableAppRowProps {
  row: AppRowData;
}

type SortableState = ReturnType<typeof useSortable>;
type DragListeners = SortableState["listeners"];
type DragAttributes = SortableState["attributes"];

function SortableAppRow({ row }: SortableAppRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <AppRow
      row={row}
      refSetter={setNodeRef}
      style={style}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  );
}

interface AppRowProps {
  row: AppRowData;
  refSetter?: (node: HTMLDivElement | null) => void;
  style?: CSSProperties;
  dragAttributes?: DragAttributes & HTMLAttributes<HTMLButtonElement>;
  dragListeners?: DragListeners;
  isOverlay?: boolean;
}

function AppRow({
  row,
  refSetter,
  style,
  dragAttributes,
  dragListeners,
  isOverlay,
}: AppRowProps) {
  const cls = [styles.row, isOverlay ? styles.rowOverlay : ""]
    .filter(Boolean)
    .join(" ");
  const { Icon } = row;

  return (
    <div
      ref={refSetter}
      className={cls}
      style={style}
      data-app-id={row.id}
      role="listitem"
    >
      <button
        type="button"
        className={styles.handle}
        aria-label={`Drag ${row.label}`}
        {...dragAttributes}
        {...dragListeners}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className={styles.label}>{row.label}</span>
    </div>
  );
}
