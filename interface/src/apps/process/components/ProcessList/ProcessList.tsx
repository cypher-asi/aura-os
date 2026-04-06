import { createPortal } from "react-dom";
import { Explorer, Menu, PageEmptyState } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Cpu, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { InlineRenameInput } from "../../../../components/InlineRenameInput";
import { DeleteProjectModal } from "../../../../components/DeleteProjectModal";
import { ProcessForm } from "../ProcessForm";
import { useProcessListState } from "./use-process-list";

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcessList() {
  const s = useProcessListState();

  if (!s.loading && s.processes.length === 0 && s.projects.length === 0) {
    return (
      <div className={styles.root}>
        <PageEmptyState
          icon={<FolderOpen size={32} />}
          title="No processes yet"
          description="Create a process to build automated workflows."
        />
        {s.showProcessForm && (
          <ProcessForm
            onClose={() => s.setShowProcessForm(false)}
            projectId={s.processFormProjectId}
            onCreated={s.setPendingSelectId}
          />
        )}
        {s.addMenuAnchor &&
          createPortal(
            <div
              ref={s.addMenuRef}
              style={{
                position: "fixed",
                left: s.addMenuAnchor.x,
                top: s.addMenuAnchor.y,
                zIndex: 9999,
              }}
            >
              <Menu
                items={addMenuItems}
                onChange={s.handleAddMenuAction}
                background="solid"
                border="solid"
                rounded="md"
                width={180}
                isOpen
              />
            </div>,
            document.body,
          )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div
        className={styles.explorerWrap}
        onContextMenu={s.handleContextMenu}
        onKeyDown={s.handleKeyDown}
      >
        <Explorer
          key={s.explorerKey}
          data={s.filteredExplorerData}
          enableDragDrop
          enableMultiSelect={false}
          defaultExpandedIds={s.defaultExpandedIds}
          defaultSelectedIds={s.defaultSelectedIds}
          onSelect={s.handleSelect}
          onDrop={s.handleDrop}
        />
      </div>

      {s.ctxMenu &&
        createPortal(
          <div
            ref={s.ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: s.ctxMenu.x, top: s.ctxMenu.y }}
          >
            <Menu
              items={
                s.ctxMenu.projectId ? projectMenuItems : processMenuItems
              }
              onChange={s.handleCtxMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={180}
              isOpen
            />
          </div>,
          document.body,
        )}

      {s.addMenuAnchor &&
        createPortal(
          <div
            ref={s.addMenuRef}
            style={{
              position: "fixed",
              left: s.addMenuAnchor.x,
              top: s.addMenuAnchor.y,
              zIndex: 9999,
            }}
          >
            <Menu
              items={addMenuItems}
              onChange={s.handleAddMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={180}
              isOpen
            />
          </div>,
          document.body,
        )}

      {s.renameTarget && (
        <InlineRenameInput
          target={s.renameTarget}
          onSave={s.handleRenameCommit}
          onCancel={() => s.setRenameTarget(null)}
        />
      )}

      <DeleteProjectModal
        target={s.deleteProjectTarget}
        loading={s.deleteProjectLoading}
        error={s.deleteProjectError}
        onClose={() => {
          s.setDeleteProjectTarget(null);
          s.setDeleteProjectError(null);
        }}
        onDelete={s.handleDeleteProject}
      />

      {s.showProcessForm && (
        <ProcessForm
          onClose={() => s.setShowProcessForm(false)}
          projectId={s.processFormProjectId}
          onCreated={s.setPendingSelectId}
        />
      )}
    </div>
  );
}
