import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import type { Follow, FollowTargetType } from "../types";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

interface FollowContextValue {
  follows: Follow[];
  followedIds: Set<string>;
  isFollowing: (targetType: FollowTargetType, targetId: string) => boolean;
  follow: (targetType: FollowTargetType, targetId: string) => Promise<void>;
  unfollow: (targetType: FollowTargetType, targetId: string) => Promise<void>;
  toggleFollow: (targetType: FollowTargetType, targetId: string) => Promise<void>;
}

const FollowCtx = createContext<FollowContextValue | null>(null);

function makeKey(targetType: FollowTargetType, targetId: string) {
  return `${targetType}:${targetId}`;
}

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

  const followedIds = useMemo(
    () => new Set(follows.map((f) => makeKey(f.target_type, f.target_id))),
    [follows],
  );

  const isFollowing = useCallback(
    (targetType: FollowTargetType, targetId: string) =>
      followedIds.has(makeKey(targetType, targetId)),
    [followedIds],
  );

  const doFollow = useCallback(
    async (targetType: FollowTargetType, targetId: string) => {
      const created = await api.follows.follow(targetType, targetId);
      setFollows((prev) => [...prev, created]);
    },
    [],
  );

  const doUnfollow = useCallback(
    async (targetType: FollowTargetType, targetId: string) => {
      await api.follows.unfollow(targetType, targetId);
      setFollows((prev) =>
        prev.filter(
          (f) => !(f.target_type === targetType && f.target_id === targetId),
        ),
      );
    },
    [],
  );

  const toggleFollow = useCallback(
    async (targetType: FollowTargetType, targetId: string) => {
      if (followedIds.has(makeKey(targetType, targetId))) {
        await doUnfollow(targetType, targetId);
      } else {
        await doFollow(targetType, targetId);
      }
    },
    [followedIds, doFollow, doUnfollow],
  );

  const value = useMemo(
    () => ({
      follows,
      followedIds,
      isFollowing,
      follow: doFollow,
      unfollow: doUnfollow,
      toggleFollow,
    }),
    [follows, followedIds, isFollowing, doFollow, doUnfollow, toggleFollow],
  );

  return <FollowCtx.Provider value={value}>{children}</FollowCtx.Provider>;
}

export function useFollow() {
  const ctx = useContext(FollowCtx);
  if (!ctx) throw new Error("useFollow must be used within FollowProvider");
  return ctx;
}
