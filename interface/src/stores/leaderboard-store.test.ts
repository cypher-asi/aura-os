import { describe, it, expect, beforeEach, vi } from "vitest";

type LeaderboardEntry = {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  tokens_used: number;
  estimated_cost_usd: number;
  event_count: number;
  profile_type: string | null;
};

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    leaderboard: { get: vi.fn() },
  },
}));

vi.mock("../api/client", () => ({ api: mockApi }));

import { useLeaderboardStore } from "./leaderboard-store";

const sampleEntry: LeaderboardEntry = {
  profile_id: "p1",
  display_name: "Alice",
  avatar_url: "https://img.test/a.png",
  tokens_used: 5000,
  estimated_cost_usd: 0.5,
  event_count: 10,
  profile_type: "user",
};

beforeEach(() => {
  useLeaderboardStore.setState({
    period: "all",
    selectedUserId: null,
    entries: [],
    loading: true,
  });
  vi.clearAllMocks();
});

describe("leaderboard-store", () => {
  describe("initial state", () => {
    it("defaults period to all", () => {
      expect(useLeaderboardStore.getState().period).toBe("all");
    });

    it("has no selectedUserId", () => {
      expect(useLeaderboardStore.getState().selectedUserId).toBeNull();
    });

    it("starts loading", () => {
      expect(useLeaderboardStore.getState().loading).toBe(true);
    });

    it("has empty entries", () => {
      expect(useLeaderboardStore.getState().entries).toEqual([]);
    });
  });

  describe("selectUser", () => {
    it("sets the selectedUserId", () => {
      useLeaderboardStore.getState().selectUser("u1");
      expect(useLeaderboardStore.getState().selectedUserId).toBe("u1");
    });

    it("can be cleared with null", () => {
      useLeaderboardStore.getState().selectUser("u1");
      useLeaderboardStore.getState().selectUser(null);
      expect(useLeaderboardStore.getState().selectedUserId).toBeNull();
    });
  });

  describe("fetchEntries", () => {
    it("maps API data to LeaderboardUser entries", async () => {
      mockApi.leaderboard.get.mockResolvedValue([sampleEntry]);

      await useLeaderboardStore.getState().fetchEntries();

      const entries = useLeaderboardStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe("p1");
      expect(entries[0].name).toBe("Alice");
      expect(entries[0].tokens).toBe(5000);
      expect(entries[0].type).toBe("user");
    });

    it("replaces UUID display names with fallback", async () => {
      mockApi.leaderboard.get.mockResolvedValue([
        { ...sampleEntry, display_name: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
      ]);

      await useLeaderboardStore.getState().fetchEntries();
      expect(useLeaderboardStore.getState().entries[0].name).toBe("Unknown");
    });

    it("uses 'Unnamed Agent' for agents with UUID names", async () => {
      mockApi.leaderboard.get.mockResolvedValue([
        {
          ...sampleEntry,
          display_name: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          profile_type: "agent",
        },
      ]);

      await useLeaderboardStore.getState().fetchEntries();
      expect(useLeaderboardStore.getState().entries[0].name).toBe("Unnamed Agent");
    });

    it("sets empty entries on error", async () => {
      mockApi.leaderboard.get.mockRejectedValue(new Error("fail"));

      await useLeaderboardStore.getState().fetchEntries();

      expect(useLeaderboardStore.getState().entries).toEqual([]);
      expect(useLeaderboardStore.getState().loading).toBe(false);
    });

    it("sets loading false after success", async () => {
      mockApi.leaderboard.get.mockResolvedValue([]);

      await useLeaderboardStore.getState().fetchEntries();

      expect(useLeaderboardStore.getState().loading).toBe(false);
    });
  });
});
