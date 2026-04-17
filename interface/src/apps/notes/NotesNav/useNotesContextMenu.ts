import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { useProjectListActions } from "../../../hooks/use-project-list-actions";
import type { Project } from "../../../types";
import { useNotesStore } from "../../../stores/notes-store";
import {
  leafName,
  parentRelPath,
  parseNotesExplorerId,
  renameRelPath,
} from "./notes-explorer-ids";

export interface NotesEntryTarget {
  kind: "note" | "folder";
  projectId: string;
  relPath: string;
  name: string;
}

export interface NotesCtxMenuState {
  x: number;
  y: number;
  target: NotesEntryTarget;
}

type ProjectActions = ReturnType<typeof useProjectListActions>;

interface Options {
  projectActions: ProjectActions;
  projectMap: Map<string, Project>;
}

export function useNotesContextMenu({ projectActions, projectMap }: Options) {
  const navigate = useNavigate();
  const renameEntry = useNotesStore((s) => s.renameEntry);
  const deleteEntry = useNotesStore((s) => s.deleteEntry);
  const createNote = useNotesStore((s) => s.createNote);
  const createFolder = useNotesStore((s) => s.createFolder);

  const [ctxMenu, setCtxMenu] = useState<NotesCtxMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<NotesEntryTarget | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<NotesEntryTarget | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const ctxMenuStateRef = useRef(ctxMenu);
  ctxMenuStateRef.current = ctxMenu;

  useEffect(() => {
    if (!ctxMenu) return;
    const handleDocumentClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const button = (e.target as HTMLElement).closest("button[id]");
      if (!button) return;
      const parsed = parseNotesExplorerId(button.id);
      if (!parsed) return;

      if (parsed.kind === "project") {
        const project = projectMap.get(parsed.projectId);
        if (!project) return;
        e.preventDefault();
        projectActions.setCtxMenu({
          x: e.clientX,
          y: e.clientY,
          project,
        });
        return;
      }

      e.preventDefault();
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        target: {
          kind: parsed.kind,
          projectId: parsed.projectId,
          relPath: parsed.relPath,
          name: leafName(parsed.relPath, parsed.kind),
        },
      });
    },
    [projectActions, projectMap],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "F2") return;
      const focused = (e.target as HTMLElement).closest("button[id]");
      if (!focused) return;
      const parsed = parseNotesExplorerId(focused.id);
      if (!parsed) return;
      if (parsed.kind === "project") {
        const project = projectMap.get(parsed.projectId);
        if (project) {
          e.preventDefault();
          projectActions.setRenameTarget(project);
        }
        return;
      }
      e.preventDefault();
      setRenameTarget({
        kind: parsed.kind,
        projectId: parsed.projectId,
        relPath: parsed.relPath,
        name: leafName(parsed.relPath, parsed.kind),
      });
    },
    [projectActions, projectMap],
  );

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const menu = ctxMenuStateRef.current;
      if (!menu) return;
      const target = menu.target;
      setCtxMenu(null);

      if (actionId === "rename") {
        setRenameTarget(target);
        return;
      }
      if (actionId === "delete") {
        setDeleteTarget(target);
        setDeleteError(null);
        return;
      }
      if (actionId === "reveal" && target.kind === "note") {
        const { projectId, relPath } = target;
        void useNotesStore
          .getState()
          .readNote(projectId, relPath)
          .then((note) => {
            if (note?.absPath) {
              void useNotesStore.getState().revealInFolder(note.absPath);
            }
          });
        return;
      }
      if (actionId === "new-note" && target.kind === "folder") {
        void createNote(target.projectId, target.relPath).then((res) => {
          if (res) {
            navigate(
              `/notes/${target.projectId}/${encodeURIComponent(res.relPath)}`,
            );
          }
        });
        return;
      }
      if (actionId === "new-folder" && target.kind === "folder") {
        const name = window.prompt("New folder name");
        if (!name || !name.trim()) return;
        void createFolder(target.projectId, target.relPath, name.trim());
      }
    },
    [createFolder, createNote, navigate],
  );

  const handleRenameSave = useCallback(
    async (newName: string) => {
      const target = renameTarget;
      setRenameTarget(null);
      if (!target) return;
      const to = renameRelPath(target.relPath, newName, target.kind);
      if (to === target.relPath || !to) return;
      await renameEntry(target.projectId, target.relPath, to);
    },
    [renameEntry, renameTarget],
  );

  const handleDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteEntry(target.projectId, target.relPath);
      // If the deleted folder contained the active note, clear stale selection.
      if (target.kind === "folder") {
        const { activeProjectId, activeRelPath } = useNotesStore.getState();
        if (
          activeProjectId === target.projectId &&
          activeRelPath &&
          (activeRelPath === target.relPath ||
            activeRelPath.startsWith(`${target.relPath}/`))
        ) {
          useNotesStore.getState().selectNote(target.projectId, null);
        }
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete entry",
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteEntry, deleteTarget]);

  return {
    ctxMenu,
    ctxMenuRef,
    handleContextMenu,
    handleKeyDown,
    handleMenuAction,
    renameTarget,
    setRenameTarget,
    handleRenameSave,
    deleteTarget,
    setDeleteTarget,
    deleteLoading,
    deleteError,
    setDeleteError,
    handleDelete,
    // Helper for NotesNav-level flows that want to reuse the parent path for
    // folder-aware "New note" creation (e.g. keyboard shortcuts).
    parentRelPathFor: (relPath: string) => parentRelPath(relPath),
  };
}
