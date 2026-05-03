import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import type { NotesComment } from "../../shared/api/notes";
import { useAuthStore } from "../auth-store";
import { makeNoteKey } from "./notes-utils";
import type { NotesStore } from "./notes-store";

export interface CommentsSlice {
  commentsByNote: Record<string, NotesComment[]>;
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
}

/**
 * Comments slice — owns the per-note comment list (`commentsByNote`)
 * and the load/add/delete actions that talk to the comments endpoints.
 * The author display name is read directly from the auth store rather
 * than threaded through arguments.
 */
export const createCommentsSlice: StateCreator<
  NotesStore,
  [],
  [],
  CommentsSlice
> = (set) => ({
  commentsByNote: {},

  loadComments: async (projectId, relPath) => {
    const key = makeNoteKey(projectId, relPath);
    if (isAuraCaptureSessionActive()) {
      set((state) => ({
        commentsByNote: {
          ...state.commentsByNote,
          [key]: state.commentsByNote[key] ?? [],
        },
      }));
      return;
    }
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
});
