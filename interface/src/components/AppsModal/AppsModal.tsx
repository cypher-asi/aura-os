import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { Modal } from "@cypher-asi/zui";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
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

  const hiddenSet = useMemo(() => new Set(taskbarHiddenAppIds), [taskbarHiddenAppIds]);

  const visibleRows = useMemo(
    () => rows.filter((row) => !hiddenSet.has(row.id)),
    [rows, hiddenSet],
  );
  const hiddenRows = useMemo(
    () => rows.filter((row) => hiddenSet.has(row.id)),
    [rows, hiddenSet],
  );

  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

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

  const commit = useCallback(
    (nextVisibleIds: string[], nextHiddenIds: string[]) => {
      // Preserve the full normalized order: visible first (in their current
      // order), then hidden (in their current order). This keeps the taskbar
      // order stable when an app is unhidden later.
      const order = [...nextVisibleIds, ...nextHiddenIds];
      saveTaskbarAppsLayout(order, nextHiddenIds);
    },
    [saveTaskbarAppsLayout],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeItemId = String(active.id);
      const overId = String(over.id);

      const activeSection = findSection(activeItemId);
      const overSection = findSection(overId);
      if (!activeSection || !overSection) return;
      if (activeSection === overSection) return;

      // Moving across sections: flip hidden membership for the active row so
      // the live preview (and the underlying taskbar) reflect the move.
      const nextHidden = new Set(taskbarHiddenAppIds);
      if (overSection === "hidden") nextHidden.add(activeItemId);
      else nextHidden.delete(activeItemId);

      const nextVisibleIds = rows
        .map((row) => row.id)
        .filter((id) => !nextHidden.has(id));
      const nextHiddenIds = rows
        .map((row) => row.id)
        .filter((id) => nextHidden.has(id));

      commit(nextVisibleIds, nextHiddenIds);
    },
    [commit, findSection, rows, taskbarHiddenAppIds],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const activeItemId = String(active.id);
      const overId = String(over.id);
      if (activeItemId === overId) return;

      const activeSection = findSection(activeItemId);
      const overSection = findSection(overId);
      if (!activeSection || !overSection) return;

      // Cross-section moves are already applied by handleDragOver — nothing
      // further to do if the drop target is another section's container.
      if (activeSection !== overSection) return;
      if (overId === "visible" || overId === "hidden") return;

      const currentHidden = new Set(taskbarHiddenAppIds);
      const sourceIds =
        activeSection === "visible"
          ? rows.filter((row) => !currentHidden.has(row.id)).map((row) => row.id)
          : rows.filter((row) => currentHidden.has(row.id)).map((row) => row.id);

      const oldIndex = sourceIds.indexOf(activeItemId);
      const newIndex = sourceIds.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(sourceIds, oldIndex, newIndex);

      const nextVisibleIds =
        activeSection === "visible"
          ? reordered
          : rows.filter((row) => !currentHidden.has(row.id)).map((row) => row.id);
      const nextHiddenIds =
        activeSection === "hidden"
          ? reordered
          : rows.filter((row) => currentHidden.has(row.id)).map((row) => row.id);

      commit(nextVisibleIds, nextHiddenIds);
    },
    [commit, findSection, rows, taskbarHiddenAppIds],
  );

  const activeRow = activeId ? rowsById.get(activeId) ?? null : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Apps" size="sm">
      <p className={styles.description}>
        Drag and drop apps to reorder them. Drag between sections to show or
        hide apps in the taskbar.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
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
        <DragOverlay>
          {activeRow ? <AppRow row={activeRow} isOverlay /> : null}
        </DragOverlay>
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
        <ul ref={setNodeRef} className={styles.list} data-section={id}>
          {rows.length === 0 ? (
            <li className={styles.empty} aria-live="polite">
              {emptyLabel}
            </li>
          ) : (
            rows.map((row) => <SortableAppRow key={row.id} row={row} />)
          )}
        </ul>
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
  refSetter?: (node: HTMLLIElement | null) => void;
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
    <li ref={refSetter} className={cls} style={style} data-app-id={row.id}>
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
    </li>
  );
}
