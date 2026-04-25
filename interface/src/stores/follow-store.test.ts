import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Follow } from "../shared/types";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    follows: {
      follow: vi.fn(),
      unfollow: vi.fn(),
      list: vi.fn(),
    },
  },
}));

vi.mock("../api/client", () => ({ api: mockApi }));

vi.mock("./auth-store", () => ({
  useAuthStore: {
    getState: () => ({ user: null }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

const mockFollows: Follow[] = [
  { id: "f1", follower_profile_id: "me", target_profile_id: "agent-1", created_at: "2025-01-01T00:00:00Z" },
];

import { useFollowStore } from "./follow-store";

beforeEach(() => {
  useFollowStore.setState({ follows: [], followedProfileIds: new Set() });
  vi.clearAllMocks();
});

describe("follow-store", () => {
  describe("initial state", () => {
    it("has empty follows", () => {
      expect(useFollowStore.getState().follows).toEqual([]);
    });

    it("has empty followedProfileIds", () => {
      expect(useFollowStore.getState().followedProfileIds.size).toBe(0);
    });
  });

  describe("isFollowing", () => {
    it("returns false when not following", () => {
      expect(useFollowStore.getState().isFollowing("agent-1")).toBe(false);
    });

    it("returns true when following", () => {
      useFollowStore.setState({
        follows: mockFollows,
        followedProfileIds: new Set(["agent-1"]),
      });
      expect(useFollowStore.getState().isFollowing("agent-1")).toBe(true);
    });
  });

  describe("follow", () => {
    it("adds a new follow and updates followedProfileIds", async () => {
      const newFollow: Follow = {
        id: "f2",
        follower_profile_id: "me",
        target_profile_id: "agent-2",
        created_at: "2025-06-01T00:00:00Z",
      };
      mockApi.follows.follow.mockResolvedValue(newFollow);

      await useFollowStore.getState().follow("agent-2");

      expect(useFollowStore.getState().follows).toHaveLength(1);
      expect(useFollowStore.getState().followedProfileIds.has("agent-2")).toBe(true);
    });

    it("propagates API errors", async () => {
      mockApi.follows.follow.mockRejectedValue(new Error("fail"));
      await expect(useFollowStore.getState().follow("agent-3")).rejects.toThrow("fail");
    });
  });

  describe("unfollow", () => {
    it("removes the follow and updates followedProfileIds", async () => {
      useFollowStore.setState({
        follows: mockFollows,
        followedProfileIds: new Set(["agent-1"]),
      });
      mockApi.follows.unfollow.mockResolvedValue(undefined);

      await useFollowStore.getState().unfollow("agent-1");

      expect(useFollowStore.getState().follows).toHaveLength(0);
      expect(useFollowStore.getState().followedProfileIds.has("agent-1")).toBe(false);
    });
  });

  describe("toggleFollow", () => {
    it("follows when not currently following", async () => {
      const newFollow: Follow = {
        id: "f3",
        follower_profile_id: "me",
        target_profile_id: "agent-4",
        created_at: "2025-06-01T00:00:00Z",
      };
      mockApi.follows.follow.mockResolvedValue(newFollow);

      await useFollowStore.getState().toggleFollow("agent-4");

      expect(mockApi.follows.follow).toHaveBeenCalledWith("agent-4");
    });

    it("unfollows when currently following", async () => {
      useFollowStore.setState({
        follows: mockFollows,
        followedProfileIds: new Set(["agent-1"]),
      });
      mockApi.follows.unfollow.mockResolvedValue(undefined);

      await useFollowStore.getState().toggleFollow("agent-1");

      expect(mockApi.follows.unfollow).toHaveBeenCalledWith("agent-1");
    });
  });
});
