import type { StateCreator } from "zustand";
import { api } from "../../api/client";
import { clearLastNote, setLastNote } from "../../utils/storage";
import type { NotesStore } from "./notes-store";

export interface SidekickSlice {
  activeProjectId: string | null;
  activeRelPath: string | null;
  sidekickTab: "toc" | "info" | "comments";
  selectNote: (projectId: string, relPath: string | null) => void;
  setSidekickTab: (tab: "toc" | "info" | "comments") => void;
  revealInFolder: (absPath: string) => Promise<void>;
}

/**
 * Sidekick slice — owns the active-note pointer (`activeProjectId` /
 * `activeRelPath`) and the sidekick-tab toggle. `selectNote` reaches
 * into the content + comments slices via `get()` to warm their caches
 * so a freshly-clicked note paints immediately.
 */
export const createSidekickSlice: StateCreator<
  NotesStore,
  [],
  [],
  SidekickSlice
> = (set, get) => ({
  activeProjectId: null,
  activeRelPath: null,
  sidekickTab: "toc",

  selectNote: (projectId, relPath) => {
    set({ activeProjectId: projectId, activeRelPath: relPath });
    if (relPath) {
      setLastNote({ projectId, relPath });
      // Fire-and-forget: the individual actions update their own slices of
      // store state on success, and swallow/log errors on failure. We attach
      // `.catch` explicitly so an unhandled rejection can't crash the app.
      get()
        .readNote(projectId, relPath)
        .catch((err) => console.warn("readNote after selectNote failed", err));
      get()
        .loadComments(projectId, relPath)
        .catch((err) =>
          console.warn("loadComments after selectNote failed", err),
        );
    } else {
      clearLastNote();
    }
  },

  setSidekickTab: (sidekickTab) => set({ sidekickTab }),

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
});
