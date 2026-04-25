import { create } from "zustand";
import type { Follow } from "../shared/types";
import { api } from "../api/client";
import { useAuthStore } from "./auth-store";

interface FollowState {
  follows: Follow[];
  followedProfileIds: Set<string>;
  isFollowing: (targetProfileId: string) => boolean;
  follow: (targetProfileId: string) => Promise<void>;
  unfollow: (targetProfileId: string) => Promise<void>;
  toggleFollow: (targetProfileId: string) => Promise<void>;
}

function deriveIds(follows: Follow[]): Set<string> {
  return new Set(follows.map((f) => f.target_profile_id));
}

export const useFollowStore = create<FollowState>()((set, get) => ({
  follows: [],
  followedProfileIds: new Set<string>(),

  isFollowing: (targetProfileId) => get().followedProfileIds.has(targetProfileId),

  follow: async (targetProfileId) => {
    const created = await api.follows.follow(targetProfileId);
    set((s) => {
      const follows = [...s.follows, created];
      return { follows, followedProfileIds: deriveIds(follows) };
    });
  },

  unfollow: async (targetProfileId) => {
    await api.follows.unfollow(targetProfileId);
    set((s) => {
      const follows = s.follows.filter((f) => f.target_profile_id !== targetProfileId);
      return { follows, followedProfileIds: deriveIds(follows) };
    });
  },

  toggleFollow: async (targetProfileId) => {
    if (get().followedProfileIds.has(targetProfileId)) {
      await get().unfollow(targetProfileId);
    } else {
      await get().follow(targetProfileId);
    }
  },
}));

let _followAuthSyncStarted = false;

/** Idempotent: subscribe to auth and sync follows when the user changes (not at module load). */
export function initFollowStoreAuthSync(): void {
  if (_followAuthSyncStarted) return;
  _followAuthSyncStarted = true;

  let _prevUserId: string | null = null;

  const applyUserId = (userId: string | null) => {
    if (userId === _prevUserId) return;
    _prevUserId = userId;
    if (userId) {
      api.follows
        .list()
        .then((follows) =>
          useFollowStore.setState({ follows, followedProfileIds: deriveIds(follows) }),
        )
        .catch(() =>
          useFollowStore.setState({ follows: [], followedProfileIds: new Set() }),
        );
    } else {
      useFollowStore.setState({ follows: [], followedProfileIds: new Set() });
    }
  };

  useAuthStore.subscribe((state) => {
    applyUserId(state.user?.user_id ?? null);
  });

  applyUserId(useAuthStore.getState().user?.user_id ?? null);
}
