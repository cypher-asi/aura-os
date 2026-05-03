import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import { clearLastNote, setLastNote } from "../../utils/storage";
import {
  countWords,
  extractTitleFromContent,
  isErrorWithStatus,
  makeNoteKey,
  pendingTimers,
  renameNoteInNodes,
  schedulePersist,
  type NoteContent,
  type NotesProjectTree,
} from "./notes-utils";
import type { NotesStore } from "./notes-store";

export interface ContentSlice {
  contentCache: Record<string, NoteContent>;
  readNote: (
    projectId: string,
    relPath: string,
  ) => Promise<NoteContent | null>;
  updateContent: (projectId: string, relPath: string, content: string) => void;
  flushNote: (projectId: string, relPath: string) => Promise<void>;
}

/**
 * Per-note content + autosave slice. Owns `contentCache` and the
 * read/write/debounced-flush pipeline. Tree titles, comments, and the
 * active-note pointer live in their own slices but are reachable from
 * here through cross-slice state writes (rename rewires both cache and
 * tree in one pass) when the server-authoritative path drifts.
 */
export const createContentSlice: StateCreator<
  NotesStore,
  [],
  [],
  ContentSlice
> = (set, get) => ({
  contentCache: {},

  readNote: async (projectId, relPath) => {
    const key = makeNoteKey(projectId, relPath);
    if (isAuraCaptureSessionActive()) {
      return get().contentCache[key] ?? null;
    }
    try {
      const res = await api.notes.read(projectId, relPath);
      const entry: NoteContent = {
        content: res.content,
        title: res.title,
        frontmatter: res.frontmatter,
        absPath: res.absPath,
        updatedAt: res.updatedAt,
        wordCount: res.wordCount,
        dirty: false,
      };
      set((state) => ({
        contentCache: { ...state.contentCache, [key]: entry },
      }));
      return entry;
    } catch (err) {
      // If the stored active selection points at a note that no longer
      // exists (deleted, moved, etc.), drop it so the UI can fall back to
      // an empty state rather than a permanent "Loading…" spinner.
      if (isErrorWithStatus(err) && err.status === 404) {
        clearLastNote();
        set((state) => {
          const { [key]: _missing, ...restContent } = state.contentCache;
          const shouldClearActive =
            state.activeProjectId === projectId && state.activeRelPath === relPath;
          return {
            contentCache: restContent,
            activeProjectId: shouldClearActive ? null : state.activeProjectId,
            activeRelPath: shouldClearActive ? null : state.activeRelPath,
          };
        });
        return null;
      }
      set((state) => {
        const existing = state.contentCache[key];
        if (!existing) return state;
        return {
          contentCache: {
            ...state.contentCache,
            [key]: {
              ...existing,
              error: err instanceof Error ? err.message : "Failed to read note",
            },
          },
        };
      });
      return null;
    }
  },

  updateContent: (projectId, relPath, content) => {
    const key = makeNoteKey(projectId, relPath);
    const existing = get().contentCache[key];
    if (!existing) return;
    const title = extractTitleFromContent(content);
    const nextEntry: NoteContent = {
      ...existing,
      content,
      title: title || existing.title,
      wordCount: countWords(content),
      dirty: true,
      error: undefined,
    };
    set((state) => {
      const tree = state.trees[projectId];
      const nextTree: NotesProjectTree | undefined = tree
        ? {
            ...tree,
            titleOverrides: {
              ...tree.titleOverrides,
              [relPath]: title,
            },
          }
        : tree;
      return {
        contentCache: { ...state.contentCache, [key]: nextEntry },
        trees: nextTree ? { ...state.trees, [projectId]: nextTree } : state.trees,
      };
    });

    schedulePersist(key, () => {
      void get().flushNote(projectId, relPath);
    });
  },

  flushNote: async (projectId, relPath) => {
    const key = makeNoteKey(projectId, relPath);
    const entry = get().contentCache[key];
    if (!entry || !entry.dirty) return;
    try {
      const res = await api.notes.write(projectId, relPath, entry.content);
      const renamed = res.relPath && res.relPath !== relPath;
      set((state) => {
        const current = state.contentCache[key];
        if (!current) return state;
        const nextEntry: NoteContent = {
          ...current,
          dirty: false,
          updatedAt: res.updatedAt,
          title: res.title || current.title,
          wordCount: res.wordCount,
          error: undefined,
          absPath: res.absPath ?? current.absPath,
        };
        if (!renamed) {
          return {
            contentCache: { ...state.contentCache, [key]: nextEntry },
          };
        }
        const newKey = makeNoteKey(projectId, res.relPath);
        const { [key]: _oldContent, ...restContent } = state.contentCache;
        const { [key]: oldComments, ...restComments } = state.commentsByNote;
        const nextActiveRelPath =
          state.activeProjectId === projectId && state.activeRelPath === relPath
            ? res.relPath
            : state.activeRelPath;

        // Patch the project tree in place so the left-menu / sidekick don't
        // flash an unselected state while waiting for a reload round-trip.
        const existingTree = state.trees[projectId];
        const nextTrees = existingTree
          ? {
              ...state.trees,
              [projectId]: {
                ...existingTree,
                nodes: renameNoteInNodes(
                  existingTree.nodes,
                  relPath,
                  res.relPath,
                  res.absPath ?? nextEntry.absPath,
                  nextEntry.title,
                  res.updatedAt,
                ),
              },
            }
          : state.trees;

        return {
          contentCache: { ...restContent, [newKey]: nextEntry },
          commentsByNote: oldComments
            ? { ...restComments, [newKey]: oldComments }
            : state.commentsByNote,
          activeRelPath: nextActiveRelPath,
          trees: nextTrees,
        };
      });
      if (renamed) {
        // Swap any pending debounce timer onto the new key so a fast-follow
        // edit after a rename still saves rather than getting orphaned.
        const pendingTimer = pendingTimers.get(key);
        if (pendingTimer) {
          pendingTimers.delete(key);
          pendingTimers.set(makeNoteKey(projectId, res.relPath), pendingTimer);
        }
        const { activeProjectId, activeRelPath } = get();
        if (activeProjectId === projectId && activeRelPath === res.relPath) {
          setLastNote({ projectId, relPath: res.relPath });
        }
      }
    } catch (err) {
      set((state) => {
        const current = state.contentCache[key];
        if (!current) return state;
        return {
          contentCache: {
            ...state.contentCache,
            [key]: {
              ...current,
              error: err instanceof Error ? err.message : "Failed to save note",
            },
          },
        };
      });
    }
  },
});
