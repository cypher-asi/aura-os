import { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";
import { ButtonPlus, Group, Text, Item, Menu, Modal, ModalConfirm, Input, Button } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import styles from "./ProjectList.module.css";

const contextMenuItems: MenuItem[] = [
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

interface ContextMenuState {
  x: number;
  y: number;
  project: Project;
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const fetchProjects = useCallback(() => {
    api.listProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!ctxMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleContextMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, project });
  };

  const handleMenuAction = (actionId: string) => {
    if (!ctxMenu) return;
    const target = ctxMenu.project;
    setCtxMenu(null);

    if (actionId === "rename") {
      setRenameName(target.name);
      setRenameTarget(target);
    } else if (actionId === "delete") {
      setDeleteTarget(target);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await api.updateProject(renameTarget.project_id, { name: renameName.trim() });
      setRenameTarget(null);
      fetchProjects();
    } catch (err) {
      console.error("Failed to rename project", err);
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteProject(deleteTarget.project_id);
      if (projectId === deleteTarget.project_id) {
        navigate("/");
      }
      setDeleteTarget(null);
      fetchProjects();
    } catch (err) {
      console.error("Failed to delete project", err);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div>
      <Group
        label="Projects"
        stats={<ButtonPlus onClick={() => navigate("/new-project")} size="sm" title="New Project" />}
      >
        {projects.length === 0 ? (
          <Text variant="muted" size="sm" style={{ padding: "var(--space-3) var(--space-4)" }}>
            No projects yet
          </Text>
        ) : (
          projects.map((p) => (
            <Item
              key={p.project_id}
              selected={projectId === p.project_id}
              onClick={() => navigate(`/projects/${p.project_id}`)}
              onContextMenu={(e: React.MouseEvent) => handleContextMenu(e, p)}
            >
              <Item.Icon><FolderOpen size={14} /></Item.Icon>
              <Item.Label>{p.name}</Item.Label>
            </Item>
          ))
        )}
      </Group>

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <Menu
              items={contextMenuItems}
              onChange={handleMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={180}
              isOpen
            />
          </div>,
          document.body,
        )}

      <Modal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename Project"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleRename} disabled={renameLoading || !renameName.trim()}>
              {renameLoading ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
          placeholder="Project name"
          autoFocus
        />
      </Modal>

      <ModalConfirm
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Project"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel={deleteLoading ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        danger
        isLoading={deleteLoading}
      />
    </div>
  );
}
