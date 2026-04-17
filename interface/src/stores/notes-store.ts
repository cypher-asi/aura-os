import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type {
  NoteFrontmatter,
  NotesComment,
  NotesTreeNode,
} from "../api/notes";
import { useAuthStore } from "./auth-store";

const AUTOSAVE_DEBOUNCE_MS = 600;

export interface NoteKey {
  projectId: string;
  relPath: string;
}

export function makeNoteKey(projectId: string, relPath: string): string {
  return `${projectId}::${relPath}`;
}

export function parseNoteKey(key: string): NoteKey | null {
  const sepIndex = key.indexOf("::");
  if (sepIndex === -1) return null;
  return {
    projectId: key.slice(0, sepIndex),
    relPath: key.slice(sepIndex + 2),
  };
}

export interface NoteContent {
  content: string;
  title: string;
  frontmatter: NoteFrontmatter;
  absPath: string;
  updatedAt?: string;
  wordCount: number;
  /** Local-only draft that hasn't been flushed to disk yet. */
  dirty: boolean;
  /** Most recent autosave error, if any. */
  error?: string;
}

export interface NotesProjectTree {
  nodes: NotesTreeNode[];
  root: string;
  loading: boolean;
  error?: string;
  /** Local overrides for derived titles (driven by live edits to line 1). */
  titleOverrides: Record<string, string>;
}

interface NotesState {
  trees: Record<string, NotesProjectTree>;
  contentCache: Record<string, NoteContent>;
  commentsByNote: Record<string, NotesComment[]>;
  activeProjectId: string | null;
  activeRelPath: string | null;
  sidekickTab: "info" | "comments";
}

interface NotesActions {
  loadTree: (projectId: string) => Promise<void>;
  selectNote: (projectId: string, relPath: string | null) => void;
  readNote: (projectId: string, relPath: string) => Promise<NoteContent | null>;
  updateContent: (projectId: string, relPath: string, content: string) => void;
  flushNote: (projectId: string, relPath: string) => Promise<void>;
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
  loadComments: (projectId: string, relPath: string) => Promise<void>;
  addComment: (
    projectId: string,
    relPath: string,
    body: string,
  ) => Promise<void>;
  deleteComment: (
    projectId: string,
    relPath: string,
    id: string,
  ) => Promise<void>;
  revealInFolder: (absPath: string) => Promise<void>;
  setSidekickTab: (tab: "info" | "comments") => void;
}

type NotesStore = NotesState & NotesActions;

function emptyProjectTree(): NotesProjectTree {
  return { nodes: [], root: "", loading: true, titleOverrides: {} };
}

/** Extract a display title from the first non-empty line of markdown content. */
export function extractTitleFromContent(content: string): string {
  const lines = content.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i += 1;
    if (i < lines.length) i += 1;
  }
  for (; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").trim();
  }
  return "";
}

export function countWords(body: string): number {
  return body
    .replace(/^---[\s\S]*?---/, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePersist(
  key: string,
  run: () => void,
): void {
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    run();
  }, AUTOSAVE_DEBOUNCE_MS);
  pendingTimers.set(key, timer);
}

export const useNotesStore = create<NotesStore>()((set, get) => ({
  trees: {},
  contentCache: {},
  commentsByNote: {},
  activeProjectId: null,
  activeRelPath: null,
  sidekickTab: "info",

  loadTree: async (projectId) => {
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

  selectNote: (projectId, relPath) => {
    set({ activeProjectId: projectId, activeRelPath: relPath });
    if (relPath) {
      void get().readNote(projectId, relPath);
      void get().loadComments(projectId, relPath);
    }
  },

  readNote: async (projectId, relPath) => {
    const key = makeNoteKey(projectId, relPath);
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
      set((state) => {
        const current = state.contentCache[key];
        if (!current) return state;
        return {
          contentCache: {
            ...state.contentCache,
            [key]: {
              ...current,
              dirty: false,
              updatedAt: res.updatedAt,
              title: res.title || current.title,
              wordCount: res.wordCount,
              error: undefined,
            },
          },
        };
      });
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

  loadComments: async (projectId, relPath) => {
    const key = makeNoteKey(projectId, relPath);
    try {
      const comments = await api.notes.listComments(projectId, relPath);
      set((state) => ({
        commentsByNote: { ...state.commentsByNote, [key]: comments },
      }));
    } catch (err) {
      console.warn("load comments failed", err);
    }
  },

  addComment: async (projectId, relPath, body) => {
    const key = makeNoteKey(projectId, relPath);
    const user = useAuthStore.getState().user;
    try {
      const comment = await api.notes.addComment(
        projectId,
        relPath,
        body,
        user?.display_name,
      );
      set((state) => ({
        commentsByNote: {
          ...state.commentsByNote,
          [key]: [...(state.commentsByNote[key] ?? []), comment],
        },
      }));
    } catch (err) {
      console.warn("add comment failed", err);
    }
  },

  deleteComment: async (projectId, relPath, id) => {
    const key = makeNoteKey(projectId, relPath);
    try {
      await api.notes.deleteComment(projectId, relPath, id);
      set((state) => ({
        commentsByNote: {
          ...state.commentsByNote,
          [key]: (state.commentsByNote[key] ?? []).filter((c) => c.id !== id),
        },
      }));
    } catch (err) {
      console.warn("delete comment failed", err);
    }
  },

  revealInFolder: async (absPath) => {
    const parent = absPath.replace(/[\\/][^\\/]*$/, "");
    try {
      const result = await api.openPath(parent);
      if (result.ok) return;
    } catch (err) {
      console.warn("openPath failed", err);
    }
    // Web fallback: copy the path to the clipboard so users can paste it
    // into their OS file manager.
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(parent);
      } catch {
        // best-effort
      }
    }
  },

  setSidekickTab: (sidekickTab) => set({ sidekickTab }),
}));

export function useActiveNote(): NoteContent | null {
  return useNotesStore(
    useShallow((s) => {
      if (!s.activeProjectId || !s.activeRelPath) return null;
      return s.contentCache[makeNoteKey(s.activeProjectId, s.activeRelPath)] ?? null;
    }),
  );
}

export function useActiveNoteKey(): NoteKey | null {
  return useNotesStore(
    useShallow((s) => {
      if (!s.activeProjectId || !s.activeRelPath) return null;
      return { projectId: s.activeProjectId, relPath: s.activeRelPath };
    }),
  );
}

export function useNotesTree(projectId: string | null): NotesProjectTree | null {
  return useNotesStore((s) => (projectId ? s.trees[projectId] ?? null : null));
}

export function useNoteComments(
  projectId: string | null,
  relPath: string | null,
): NotesComment[] {
  return useNotesStore(
    useShallow((s) => {
      if (!projectId || !relPath) return [];
      return s.commentsByNote[makeNoteKey(projectId, relPath)] ?? [];
    }),
  );
}

/** Returns ms timeout so tests can override the debounce. */
export const NOTES_AUTOSAVE_DEBOUNCE_MS = AUTOSAVE_DEBOUNCE_MS;
