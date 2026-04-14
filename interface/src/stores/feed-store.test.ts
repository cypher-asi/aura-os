import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FeedEventDto } from "../api/social";

vi.mock("../api/client", () => ({
  api: {
    feed: {
      list: vi.fn<() => Promise<FeedEventDto[]>>().mockResolvedValue([]),
      createPost: vi.fn<() => Promise<FeedEventDto>>(),
      addComment: vi.fn(),
      getComments: vi.fn<() => Promise<never[]>>().mockResolvedValue([]),
    },
    users: {
      me: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("./auth-store", () => ({
  useAuthStore: {
    getState: () => ({ user: null }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("./event-store", () => ({
  useEventStore: {
    getState: () => ({
      subscribe: vi.fn(() => vi.fn()),
    }),
  },
}));

vi.mock("./follow-store", () => ({
  useFollowStore: vi.fn((sel: (s: { follows: never[] }) => unknown) =>
    sel({ follows: [] }),
  ),
}));

import {
  useFeedStore,
  networkEventToFeedEvent,
  networkCommentToFeedComment,
} from "./feed-store";
import { api } from "../api/client";

const mockApi = api as {
  feed: {
    list: ReturnType<typeof vi.fn>;
    createPost: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
    getComments: ReturnType<typeof vi.fn>;
  };
  users: { me: ReturnType<typeof vi.fn> };
};

function makeFeedEventDto(overrides: Partial<FeedEventDto> = {}): FeedEventDto {
  return {
    id: "evt-1",
    profile_id: "p1",
    event_type: "push",
    post_type: "push",
    title: "Test push",
    summary: "A summary",
    metadata: {
      author_name: "Agent",
      author_type: "agent",
      repo: "owner/repo",
      branch: "main",
      commits: [{ sha: "abc123", message: "feat: thing" }],
    },
    commit_ids: ["abc123"],
    created_at: "2025-06-01T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  useFeedStore.setState({
    liveEvents: null,
    userAvatarUrl: undefined,
    filter: "my-agents",
    selectedEventId: null,
    selectedProfile: null,
    comments: [],
  });
  vi.clearAllMocks();
  mockApi.feed.list.mockResolvedValue([]);
  mockApi.feed.getComments.mockResolvedValue([]);
  mockApi.users.me.mockResolvedValue({});
});

describe("feed-store", () => {
  describe("initial state", () => {
    it("has null liveEvents", () => {
      expect(useFeedStore.getState().liveEvents).toBeNull();
    });

    it("defaults filter to my-agents", () => {
      expect(useFeedStore.getState().filter).toBe("my-agents");
    });

    it("has no selectedEventId", () => {
      expect(useFeedStore.getState().selectedEventId).toBeNull();
    });

    it("has no selectedProfile", () => {
      expect(useFeedStore.getState().selectedProfile).toBeNull();
    });

    it("has empty comments", () => {
      expect(useFeedStore.getState().comments).toEqual([]);
    });
  });

  describe("setFilter", () => {
    it("updates the filter", () => {
      useFeedStore.getState().setFilter("everything");
      expect(useFeedStore.getState().filter).toBe("everything");
    });
  });

  describe("selectEvent", () => {
    it("sets the selectedEventId", () => {
      useFeedStore.getState().selectEvent("evt-1");
      expect(useFeedStore.getState().selectedEventId).toBe("evt-1");
    });

    it("clears selectedProfile when selecting an event", () => {
      useFeedStore.setState({ selectedProfile: { name: "A", type: "user" } });
      useFeedStore.getState().selectEvent("evt-1");
      expect(useFeedStore.getState().selectedProfile).toBeNull();
    });

    it("can be cleared with null", () => {
      useFeedStore.getState().selectEvent("evt-1");
      useFeedStore.getState().selectEvent(null);
      expect(useFeedStore.getState().selectedEventId).toBeNull();
    });
  });

  describe("selectProfile", () => {
    it("sets the selectedProfile", () => {
      const profile = { name: "Agent", type: "agent" as const };
      useFeedStore.getState().selectProfile(profile);
      expect(useFeedStore.getState().selectedProfile).toEqual(profile);
    });

    it("clears selectedEventId when selecting a profile", () => {
      useFeedStore.setState({ selectedEventId: "evt-1" });
      useFeedStore.getState().selectProfile({ name: "X", type: "user" });
      expect(useFeedStore.getState().selectedEventId).toBeNull();
    });
  });

  describe("createPost", () => {
    it("prepends the new post to liveEvents", async () => {
      const dto = makeFeedEventDto({ id: "new-post", post_type: "post" });
      mockApi.feed.createPost.mockResolvedValue(dto);

      useFeedStore.setState({ liveEvents: [] });
      await useFeedStore.getState().createPost("My Post", "Summary");

      expect(useFeedStore.getState().liveEvents).toHaveLength(1);
      expect(useFeedStore.getState().liveEvents![0].id).toBe("new-post");
    });
  });
});

describe("networkEventToFeedEvent", () => {
  it("maps a DTO to a FeedEvent", () => {
    const dto = makeFeedEventDto();
    const result = networkEventToFeedEvent(dto);

    expect(result.id).toBe("evt-1");
    expect(result.postType).toBe("push");
    expect(result.title).toBe("Test push");
    expect(result.author.name).toBe("Agent");
    expect(result.author.type).toBe("agent");
    expect(result.repo).toBe("owner/repo");
    expect(result.branch).toBe("main");
    expect(result.commits).toEqual([{ sha: "abc123", message: "feat: thing" }]);
    expect(result.commitIds).toEqual(["abc123"]);
    expect(result.timestamp).toBe("2025-06-01T12:00:00Z");
  });

  it("handles missing metadata gracefully", () => {
    const dto: FeedEventDto = {
      id: "evt-2",
      profile_id: "p1",
      event_type: "push",
      metadata: null,
      created_at: null,
    };
    const result = networkEventToFeedEvent(dto);
    expect(result.author.name).toBe("Unknown");
    expect(result.repo).toBe("");
    expect(result.commits).toEqual([]);
  });
});

describe("networkCommentToFeedComment", () => {
  it("maps a network comment to FeedComment", () => {
    const net = {
      id: "c1",
      activity_event_id: "evt-1",
      profile_id: "user-1",
      content: "Nice!",
      created_at: "2025-06-01T12:00:00Z",
    };
    const result = networkCommentToFeedComment(net);
    expect(result.id).toBe("c1");
    expect(result.eventId).toBe("evt-1");
    expect(result.text).toBe("Nice!");
  });
});
