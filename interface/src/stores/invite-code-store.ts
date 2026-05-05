import { create } from "zustand";
import { authApi } from "../shared/api/auth";

const STORAGE_PREFIX = "aura.invite-code";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readCachedCode(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeCachedCode(userId: string, code: string): void {
  try {
    localStorage.setItem(storageKey(userId), code);
  } catch {
    // ignore quota / unavailable storage
  }
}

function clearCachedCode(userId: string): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}

interface InviteCodeState {
  code: string | null;
  userId: string | null;
  loading: boolean;
  error: boolean;
  /**
   * Resolve `code` for the given user. Hydrates from `localStorage` first
   * (instant render on subsequent visits) and only hits the API when the
   * store has no cached value for this user. Concurrent calls coalesce so
   * remounting the consumer mid-flight does not start a second fetch.
   */
  ensure: (userId: string) => Promise<void>;
  reset: () => void;
}

let inflight: Promise<void> | null = null;

export const useInviteCodeStore = create<InviteCodeState>()((set, get) => ({
  code: null,
  userId: null,
  loading: false,
  error: false,

  ensure: async (userId: string) => {
    const state = get();
    if (state.userId === userId && state.code !== null) return;

    if (state.userId !== userId) {
      const cached = readCachedCode(userId);
      set({
        userId,
        code: cached,
        error: false,
      });
      if (cached !== null) return;
    } else if (state.code !== null) {
      return;
    }

    if (inflight) return inflight;

    set({ loading: true, error: false });
    inflight = (async () => {
      try {
        const res = await authApi.getMyInviteCode();
        if (get().userId !== userId) return;
        writeCachedCode(userId, res.slug);
        set({ code: res.slug, loading: false, error: false });
      } catch {
        if (get().userId !== userId) return;
        set({ loading: false, error: true });
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  },

  reset: () => {
    const current = get().userId;
    if (current) clearCachedCode(current);
    inflight = null;
    set({ code: null, userId: null, loading: false, error: false });
  },
}));
