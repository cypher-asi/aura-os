import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { Menu, PageEmptyState } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Cpu, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { InlineRenameInput } from "../../../../components/InlineRenameInput";
import { DeleteProjectModal } from "../../../../components/DeleteProjectModal";
import { LeftMenuTree } from "../../../../features/left-menu";
import { ProcessForm } from "../ProcessForm";
import { useProcessListState } from "./use-process-list";
import treeStyles from "../../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";
import styles from "../../../../components/ProjectList/ProjectList.module.css";

// ---------------------------------------------------------------------------
// Context-menu items
// ---------------------------------------------------------------------------

const projectMenuItems: MenuItem[] = [
  { id: "add-process", label: "Add Process", icon: <Cpu size={14} /> },
  { id: "rename-project", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete-project", label: "Delete", icon: <Trash2 size={14} /> },
];

const processMenuItems: MenuItem[] = [
  { id: "rename-process", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete-process", label: "Delete", icon: <Trash2 size={14} /> },
];

const addMenuItems: MenuItem[] = [
  { id: "new-process", label: "New Process", icon: <Cpu size={14} /> },
];

const explorerNodeStyles = {
  projectSuffix: treeStyles.projectSuffix,
  newChatWrap: treeStyles.newChatWrap,
  sessionIndicator: treeStyles.sessionIndicator,
  automationSpinner: treeStyles.automationSpinner,
  streamingDot: treeStyles.streamingDot,
};

type ProcessListState = ReturnType<typeof useProcessListState>;

function FloatingMenu({
  anchor,
  menuRef,
  items,
  onChange,
}: {
  anchor: { x: number; y: number };
  menuRef: RefObject<HTMLDivElement | null>;
  items: MenuItem[];
  onChange: (id: string) => void | Promise<void>;
}) {
  return createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenuOverlay}
      style={{ left: anchor.x, top: anchor.y, position: "fixed", zIndex: 9999 }}
    >
      <Menu
        items={items}
        onChange={onChange}
        background="solid"
        border="solid"
        rounded="md"
        width={180}
        isOpen
      />
    </div>,
    document.body,
  );
}

function ProcessListEmptyState({
  addMenuAnchor,
  addMenuRef,
  onAddMenuAction,
  processFormProjectId,
  setPendingSelectId,
  setShowProcessForm,
  showProcessForm,
}: {
  addMenuAnchor: { x: number; y: number } | null;
  addMenuRef: RefObject<HTMLDivElement | null>;
  onAddMenuAction: (id: string) => void;
  processFormProjectId: string | null;
  setPendingSelectId: (value: string | null) => void;
  setShowProcessForm: (value: boolean) => void;
  showProcessForm: boolean;
}) {
  return (
    <div className={treeStyles.root}>
      <PageEmptyState
        icon={<FolderOpen size={32} />}
        title="No processes yet"
        description="Create a process to build automated workflows."
      />
      {showProcessForm ? (
        <ProcessForm
          onClose={() => setShowProcessForm(false)}
          projectId={processFormProjectId}
          onCreated={setPendingSelectId}
        />
      ) : null}
      {addMenuAnchor ? (
        <FloatingMenu
          anchor={addMenuAnchor}
          menuRef={addMenuRef}
          items={addMenuItems}
          onChange={onAddMenuAction}
        />
      ) : null}
    </div>
  );
}

function ProcessListMenus({ state }: { state: ProcessListState }) {
  return (
    <>
      {state.ctxMenu ? (
        <FloatingMenu
          anchor={state.ctxMenu}
          menuRef={state.ctxMenuRef}
          items={state.ctxMenu.projectId ? projectMenuItems : processMenuItems}
          onChange={state.handleCtxMenuAction}
        />
      ) : null}
      {state.addMenuAnchor ? (
        <FloatingMenu
          anchor={state.addMenuAnchor}
          menuRef={state.addMenuRef}
          items={addMenuItems}
          onChange={state.handleAddMenuAction}
        />
      ) : null}
    </>
  );
}

function ProcessListModalsSection({ state }: { state: ProcessListState }) {
  return (
    <>
      {state.renameTarget ? (
        <InlineRenameInput
          target={state.renameTarget}
          onSave={state.handleRenameCommit}
          onCancel={() => state.setRenameTarget(null)}
        />
      ) : null}
      <DeleteProjectModal
        target={state.deleteProjectTarget}
        loading={state.deleteProjectLoading}
        error={state.deleteProjectError}
        onClose={() => {
          state.setDeleteProjectTarget(null);
          state.setDeleteProjectError(null);
        }}
        onDelete={state.handleDeleteProject}
      />
      {state.showProcessForm ? (
        <ProcessForm
          onClose={() => state.setShowProcessForm(false)}
          projectId={state.processFormProjectId}
          onCreated={state.setPendingSelectId}
        />
      ) : null}
    </>
  );
}

function ProcessListContent({ state }: { state: ProcessListState }) {
  return (
    <div className={treeStyles.root}>
      <LeftMenuTree
        ariaLabel="Processes"
        entries={state.entries}
        onContextMenu={state.handleContextMenu}
        onKeyDown={state.handleKeyDown}
      />
      <ProcessListMenus state={state} />
      <ProcessListModalsSection state={state} />
    </div>
  );
}

export function ProcessList() {
  const state = useProcessListState(explorerNodeStyles);

  if (state.isEmptyState) {
    return (
      <ProcessListEmptyState
        addMenuAnchor={state.addMenuAnchor}
        addMenuRef={state.addMenuRef}
        onAddMenuAction={state.handleAddMenuAction}
        processFormProjectId={state.processFormProjectId}
        setPendingSelectId={state.setPendingSelectId}
        setShowProcessForm={state.setShowProcessForm}
        showProcessForm={state.showProcessForm}
      />
    );
  }

  return <ProcessListContent state={state} />;
}
