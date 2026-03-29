import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FeedEventDto } from "../api/social";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    feed: {
      addComment: vi.fn(),
      getComments: vi.fn().mockResolvedValue([]),
      getProfilePosts: vi.fn().mockResolvedValue([]),
    },
    users: {
      me: vi.fn().mockResolvedValue({
        id: "nu1",
        profile_id: "p1",
        display_name: "Test User",
        avatar_url: null,
        bio: "bio",
        location: "Earth",
        website: "https://example.com",
        created_at: "2025-01-01T00:00:00Z",
      }),
      updateMe: vi.fn().mockResolvedValue({}),
    },
    listProjects: vi.fn().mockResolvedValue([]),
    usage: {
      personal: vi.fn().mockResolvedValue({ total_tokens: 0 }),
    },
  },
}));

vi.mock("../api/client", () => ({ api: mockApi }));

vi.mock("./auth-store", () => ({
  useAuthStore: {
    getState: () => ({
      user: {
        user_id: "u1",
        display_name: "Test User",
        profile_id: "p1",
        network_user_id: "nu1",
        profile_image: "",
        primary_zid: "test-zid",
        zero_wallet: "0x",
        wallets: [],
      },
    }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("./feed-store", () => ({
  networkEventToFeedEvent: (dto: FeedEventDto) => ({
    id: dto.id,
    postType: dto.post_type ?? "push",
    title: dto.title ?? "",
    author: { name: "Agent", type: "agent" },
    repo: "",
    branch: "main",
    commits: [],
    commitIds: [],
    timestamp: dto.created_at ?? new Date().toISOString(),
    eventType: dto.event_type,
  }),
  networkCommentToFeedComment: (net: { id: string; activity_event_id: string; content: string; created_at: string | null }) => ({
    id: net.id,
    eventId: net.activity_event_id,
    author: { name: "user", type: "user" },
    text: net.content,
    timestamp: net.created_at ?? new Date().toISOString(),
  }),
}));

import { useProfileStore } from "./profile-store";

beforeEach(() => {
  useProfileStore.setState({
    profile: {
      name: "Test User",
      handle: "@test-zid",
      bio: "",
      website: "",
      location: "",
      joinedDate: "2025-01-01T00:00:00Z",
      id: "p1",
      networkUserId: "nu1",
      avatarUrl: undefined,
    },
    projects: [],
    liveEvents: [],
    totalTokenUsage: 0,
    selectedProject: null,
    selectedEventId: null,
    comments: [],
  });
  vi.clearAllMocks();
  mockApi.feed.getComments.mockResolvedValue([]);
});

describe("profile-store", () => {
  describe("initial state", () => {
    it("has a profile with name and handle", () => {
      const { profile } = useProfileStore.getState();
      expect(profile.name).toBe("Test User");
      expect(profile.handle).toBe("@test-zid");
    });

    it("has empty projects", () => {
      expect(useProfileStore.getState().projects).toEqual([]);
    });

    it("has empty liveEvents", () => {
      expect(useProfileStore.getState().liveEvents).toEqual([]);
    });

    it("has zero totalTokenUsage", () => {
      expect(useProfileStore.getState().totalTokenUsage).toBe(0);
    });

    it("has no selected items", () => {
      expect(useProfileStore.getState().selectedProject).toBeNull();
      expect(useProfileStore.getState().selectedEventId).toBeNull();
    });
  });

  describe("updateProfile", () => {
    it("merges partial updates into profile", () => {
      useProfileStore.getState().updateProfile({ bio: "New bio" });
      expect(useProfileStore.getState().profile.bio).toBe("New bio");
      expect(useProfileStore.getState().profile.name).toBe("Test User");
    });

    it("calls api.users.updateMe for network-synced fields", () => {
      useProfileStore.getState().updateProfile({ name: "Updated", bio: "Bio2" });
      expect(mockApi.users.updateMe).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: "Updated", bio: "Bio2" }),
      );
    });

    it("does not call API when no network fields change", () => {
      useProfileStore.getState().updateProfile({});
      expect(mockApi.users.updateMe).not.toHaveBeenCalled();
    });
  });

  describe("setSelectedProject", () => {
    it("sets selectedProject and clears selectedEventId", () => {
      useProfileStore.setState({ selectedEventId: "evt-1" });
      useProfileStore.getState().setSelectedProject("proj-1");

      expect(useProfileStore.getState().selectedProject).toBe("proj-1");
      expect(useProfileStore.getState().selectedEventId).toBeNull();
    });

    it("can be cleared with null", () => {
      useProfileStore.getState().setSelectedProject("proj-1");
      useProfileStore.getState().setSelectedProject(null);
      expect(useProfileStore.getState().selectedProject).toBeNull();
    });
  });

  describe("selectEvent", () => {
    it("sets selectedEventId", () => {
      useProfileStore.getState().selectEvent("evt-1");
      expect(useProfileStore.getState().selectedEventId).toBe("evt-1");
    });
  });

  describe("addComment", () => {
    it("appends a local fallback comment on API failure", async () => {
      mockApi.feed.addComment.mockRejectedValue(new Error("fail"));
      useProfileStore.getState().addComment("evt-1", "Hello");

      await vi.waitFor(() => {
        expect(useProfileStore.getState().comments).toHaveLength(1);
      });

      const comment = useProfileStore.getState().comments[0];
      expect(comment.text).toBe("Hello");
      expect(comment.eventId).toBe("evt-1");
    });
  });
});
