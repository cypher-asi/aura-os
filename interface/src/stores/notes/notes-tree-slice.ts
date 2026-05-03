import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import { clearLastNote } from "../../utils/storage";
import { emptyProjectTree, type NotesProjectTree } from "./notes-utils";
import type { NotesStore } from "./notes-store";

export interface TreeSlice {
  trees: Record<string, NotesProjectTree>;
  loadTree: (projectId: string) => Promise<void>;
  createNote: (
    projectId: string,
    parentPath: string,
    name?: string,
  ) => Promise<{ relPath: string } | null>;
  createFolder: (
    projectId: string,
    parentPath: string,
    name: string,
  ) => Promise<{ relPath: string } | null>;
  deleteEntry: (projectId: string, relPath: string) => Promise<void>;
  renameEntry: (
    projectId: string,
    from: string,
    to: string,
  ) => Promise<{ relPath: string } | null>;
}

/**
 * Tree CRUD slice — owns the per-project notes tree (`trees`) and the
 * actions that mutate the on-disk note hierarchy. Cross-slice
 * `selectNote` / `clearLastNote` cleanup on delete is reached through
 * `get()` so we don't duplicate that logic here.
 */
export const createTreeSlice: StateCreator<NotesStore, [], [], TreeSlice> = (
  set,
  get,
) => ({
  trees: {},

  loadTree: async (projectId) => {
    if (isAuraCaptureSessionActive() && get().trees[projectId]) {
      set((state) => ({
        trees: {
          ...state.trees,
          [projectId]: {
            ...state.trees[projectId],
            loading: false,
            error: undefined,
          },
        },
      }));
      return;
    }
    set((state) => ({
      trees: {
        ...state.trees,
        [projectId]: {
          ...(state.trees[projectId] ?? emptyProjectTree()),
          loading: true,
          error: undefined,
        },
      },
    }));
    try {
      const res = await api.notes.tree(projectId);
      set((state) => ({
        trees: {
          ...state.trees,
          [projectId]: {
            nodes: res.nodes,
            root: res.root,
            loading: false,
            titleOverrides: state.trees[projectId]?.titleOverrides ?? {},
          },
        },
      }));
    } catch (err) {
      set((state) => ({
        trees: {
          ...state.trees,
          [projectId]: {
            ...(state.trees[projectId] ?? emptyProjectTree()),
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load notes",
          },
        },
      }));
    }
  },

  createNote: async (projectId, parentPath, name) => {
    try {
      const res = await api.notes.create(
        projectId,
        parentPath,
        name ?? "Untitled",
        "note",
      );
      await get().loadTree(projectId);
      get().selectNote(projectId, res.relPath);
      return { relPath: res.relPath };
    } catch (err) {
      console.warn("create note failed", err);
      return null;
    }
  },

  createFolder: async (projectId, parentPath, name) => {
    try {
      const res = await api.notes.create(projectId, parentPath, name, "folder");
      await get().loadTree(projectId);
      return { relPath: res.relPath };
    } catch (err) {
      console.warn("create folder failed", err);
      return null;
    }
  },

  deleteEntry: async (projectId, relPath) => {
    try {
      await api.notes.delete(projectId, relPath);
      await get().loadTree(projectId);
      const { activeProjectId, activeRelPath } = get();
      if (activeProjectId === projectId && activeRelPath === relPath) {
        set({ activeRelPath: null });
        clearLastNote();
      }
    } catch (err) {
      console.warn("delete note failed", err);
    }
  },

  renameEntry: async (projectId, from, to) => {
    try {
      const res = await api.notes.rename(projectId, from, to);
      await get().loadTree(projectId);
      return { relPath: res.relPath };
    } catch (err) {
      console.warn("rename note failed", err);
      return null;
    }
  },
});
