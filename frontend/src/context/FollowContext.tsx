import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import type { Follow } from "../types";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

interface FollowContextValue {
  follows: Follow[];
  followedProfileIds: Set<string>;
  isFollowing: (targetProfileId: string) => boolean;
  follow: (targetProfileId: string) => Promise<void>;
  unfollow: (targetProfileId: string) => Promise<void>;
  toggleFollow: (targetProfileId: string) => Promise<void>;
}

const FollowCtx = createContext<FollowContextValue | null>(null);

export function FollowProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [follows, setFollows] = useState<Follow[]>([]);

  useEffect(() => {
    if (!user) {
      setFollows([]);
      return;
    }
    api.follows.list().then(setFollows).catch(() => setFollows([]));
  }, [user]);

  const followedProfileIds = useMemo(
    () => new Set(follows.map((f) => f.target_profile_id)),
    [follows],
  );

  const isFollowing = useCallback(
    (targetProfileId: string) => followedProfileIds.has(targetProfileId),
    [followedProfileIds],
  );

  const doFollow = useCallback(
    async (targetProfileId: string) => {
      const created = await api.follows.follow(targetProfileId);
      setFollows((prev) => [...prev, created]);
    },
    [],
  );

  const doUnfollow = useCallback(
    async (targetProfileId: string) => {
      await api.follows.unfollow(targetProfileId);
      setFollows((prev) =>
        prev.filter((f) => f.target_profile_id !== targetProfileId),
      );
    },
    [],
  );

  const toggleFollow = useCallback(
    async (targetProfileId: string) => {
      if (followedProfileIds.has(targetProfileId)) {
        await doUnfollow(targetProfileId);
      } else {
        await doFollow(targetProfileId);
      }
    },
    [followedProfileIds, doFollow, doUnfollow],
  );

  const value = useMemo(
    () => ({
      follows,
      followedProfileIds,
      isFollowing,
      follow: doFollow,
      unfollow: doUnfollow,
      toggleFollow,
    }),
    [follows, followedProfileIds, isFollowing, doFollow, doUnfollow, toggleFollow],
  );

  return <FollowCtx.Provider value={value}>{children}</FollowCtx.Provider>;
}

export function useFollow() {
  const ctx = useContext(FollowCtx);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
