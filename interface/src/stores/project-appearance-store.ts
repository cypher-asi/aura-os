import { create } from "zustand";
import { appearanceApi, type ProjectAppearance } from "../shared/api/appearance";

/**
 * Per-project appearance cache. Keyed by `project_id` so navigating
 * between projects doesn't flash defaults while the next project's
 * settings load.
 *
 * The store is intentionally thin: each project's appearance is owned
 * by the server (`<workspace>/.aura/appearance.json`) and this is a
 * fetch-and-cache layer over that. Updates write through to the
 * server but apply optimistically so the UI can preview changes
 * without waiting for the round-trip.
 *
 * The banner is **not** stored in this state — it's served at a
 * predictable URL (`/api/projects/:id/appearance/banner`) and
 * consumed via plain `<img>`. The `bannerVersion` counter exists so
 * the UI can cache-bust after upload/delete (append `?v=` to the URL)
 * without needing to model the binary in JS.
 */

interface AppearanceEntry {
  appearance: ProjectAppearance;
  loaded: boolean;
  loading: boolean;
  /** Bumped on successful banner upload/delete so `<img>` URLs can
   * cache-bust by appending `?v=${bannerVersion}` */
  bannerVersion: number;
  /** Same idea as `bannerVersion` but for the background image
   *  served at `/appearance/background-image`. */
  backgroundImageVersion: number;
}

interface ProjectAppearanceState {
  entries: Map<string, AppearanceEntry>;
  /** Pending in-flight load promises, deduped per project. */
  inflight: Map<string, Promise<ProjectAppearance>>;

  /** Returns the cached entry or a fresh blank one. Never undefined
   *  so callers don't have to null-check during render. */
  getEntry: (projectId: string) => AppearanceEntry;

  /** Trigger a load if not already loaded/loading. Resolves to the
   *  loaded appearance. */
  load: (projectId: string) => Promise<ProjectAppearance>;

  /** Optimistic update + server write. The provided shape is the
   *  full desired state — the server doesn't merge. */
  update: (projectId: string, next: ProjectAppearance) => Promise<void>;

  /** Upload a PNG/JPEG banner blob and bump the banner version so
   *  `<img>` URLs cache-bust. */
  uploadBanner: (projectId: string, blob: Blob) => Promise<void>;

  /** Delete the banner and bump the version so currently-mounted
   *  `<img>` elements re-fetch and render the fallback. */
  deleteBanner: (projectId: string) => Promise<void>;

  /** Upload a PNG/JPEG background image blob and bump the version. */
  uploadBackgroundImage: (projectId: string, blob: Blob) => Promise<void>;

  /** Delete the background image and bump the version. */
  deleteBackgroundImage: (projectId: string) => Promise<void>;
}

const EMPTY_ENTRY: AppearanceEntry = {
  appearance: {},
  loaded: false,
  loading: false,
  bannerVersion: 0,
  backgroundImageVersion: 0,
};

export const useProjectAppearanceStore = create<ProjectAppearanceState>((set, get) => ({
  entries: new Map(),
  inflight: new Map(),

  getEntry: (projectId) => get().entries.get(projectId) ?? EMPTY_ENTRY,

  load: async (projectId) => {
    const state = get();
    const cached = state.entries.get(projectId);
    if (cached?.loaded) return cached.appearance;
    const inflight = state.inflight.get(projectId);
    if (inflight) return inflight;

    set((s) => {
      const entries = new Map(s.entries);
      entries.set(projectId, {
        ...(entries.get(projectId) ?? EMPTY_ENTRY),
        loading: true,
      });
      return { entries };
    });

    const promise = appearanceApi
      .get(projectId)
      .then((appearance) => {
        set((s) => {
          const entries = new Map(s.entries);
          const prev = entries.get(projectId) ?? EMPTY_ENTRY;
          entries.set(projectId, {
            ...prev,
            appearance,
            loaded: true,
            loading: false,
          });
          const inflight = new Map(s.inflight);
          inflight.delete(projectId);
          return { entries, inflight };
        });
        return appearance;
      })
      .catch((err) => {
        set((s) => {
          const entries = new Map(s.entries);
          const prev = entries.get(projectId) ?? EMPTY_ENTRY;
          entries.set(projectId, { ...prev, loading: false });
          const inflight = new Map(s.inflight);
          inflight.delete(projectId);
          return { entries, inflight };
        });
        throw err;
      });

    set((s) => {
      const inflight = new Map(s.inflight);
      inflight.set(projectId, promise);
      return { inflight };
    });

    return promise;
  },

  update: async (projectId, next) => {
    // Optimistic write so the UI previews the change instantly.
    const previous = get().getEntry(projectId).appearance;
    set((s) => {
      const entries = new Map(s.entries);
      const prev = entries.get(projectId) ?? EMPTY_ENTRY;
      entries.set(projectId, {
        ...prev,
        appearance: next,
        loaded: true,
      });
      return { entries };
    });
    try {
      const saved = await appearanceApi.update(projectId, next);
      // The server echoes the persisted shape, which may be
      // formatted differently (e.g. stripped of undefined keys). Take
      // the server's version as authoritative.
      set((s) => {
        const entries = new Map(s.entries);
        const prev = entries.get(projectId) ?? EMPTY_ENTRY;
        entries.set(projectId, {
          ...prev,
          appearance: saved,
          loaded: true,
        });
        return { entries };
      });
    } catch (err) {
      // Roll back the optimistic update so the UI doesn't lie about
      // what's persisted.
      set((s) => {
        const entries = new Map(s.entries);
        const prev = entries.get(projectId) ?? EMPTY_ENTRY;
        entries.set(projectId, { ...prev, appearance: previous });
        return { entries };
      });
      throw err;
    }
  },

  uploadBanner: async (projectId, blob) => {
    await appearanceApi.uploadBanner(projectId, blob);
    set((s) => {
      const entries = new Map(s.entries);
      const prev = entries.get(projectId) ?? EMPTY_ENTRY;
      entries.set(projectId, {
        ...prev,
        bannerVersion: prev.bannerVersion + 1,
      });
      return { entries };
    });
  },

  deleteBanner: async (projectId) => {
    await appearanceApi.deleteBanner(projectId);
    set((s) => {
      const entries = new Map(s.entries);
      const prev = entries.get(projectId) ?? EMPTY_ENTRY;
      entries.set(projectId, {
        ...prev,
        bannerVersion: prev.bannerVersion + 1,
      });
      return { entries };
    });
  },

  uploadBackgroundImage: async (projectId, blob) => {
    await appearanceApi.uploadBackgroundImage(projectId, blob);
    set((s) => {
      const entries = new Map(s.entries);
      const prev = entries.get(projectId) ?? EMPTY_ENTRY;
      entries.set(projectId, {
        ...prev,
        backgroundImageVersion: prev.backgroundImageVersion + 1,
      });
      return { entries };
    });
  },

  deleteBackgroundImage: async (projectId) => {
    await appearanceApi.deleteBackgroundImage(projectId);
    set((s) => {
      const entries = new Map(s.entries);
      const prev = entries.get(projectId) ?? EMPTY_ENTRY;
      entries.set(projectId, {
        ...prev,
        backgroundImageVersion: prev.backgroundImageVersion + 1,
      });
      return { entries };
    });
  },
}));
