import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommentDto } from "../../api/social";

vi.mock("../../api/client", () => ({
  api: {
    feed: {
      addComment: vi.fn<() => Promise<CommentDto>>(),
      getComments: vi.fn<() => Promise<CommentDto[]>>().mockResolvedValue([]),
    },
  },
}));

import {
  createEventCommentsSlice,
  setupCommentLoadingSubscription,
  networkCommentToFeedComment,
  type EventCommentsState,
  type EventCommentsSlice,
  type FeedComment,
} from "./event-comments-slice";
import { api } from "../../api/client";

const mockApi = api as {
  feed: {
    addComment: ReturnType<typeof vi.fn>;
    getComments: ReturnType<typeof vi.fn>;
  };
};

function makeCommentDto(overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    id: "net-c1",
    activity_event_id: "evt-1",
    profile_id: "user-1",
    content: "Hello!",
    created_at: "2025-06-01T12:00:00Z",
    ...overrides,
  };
}

type SliceStore = EventCommentsSlice;

function createTestStore() {
  let state: SliceStore;
  const listeners: Array<(s: SliceStore, prev: SliceStore) => void> = [];

  const set = (
    partial:
      | Partial<EventCommentsState>
      | ((s: SliceStore) => Partial<EventCommentsState>),
  ) => {
    const prev = { ...state };
    const patch = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...patch };
    for (const l of listeners) l(state, prev);
  };

  const subscribe = (listener: (s: SliceStore, prev: SliceStore) => void) => {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  };

  const setState = (updater: (s: SliceStore) => Partial<SliceStore>) => {
    const prev = { ...state };
    const patch = updater(state);
    state = { ...state, ...patch };
    for (const l of listeners) l(state, prev);
  };

  const slice = createEventCommentsSlice<SliceStore>(set, {
    idPrefix: "test-cmt",
    getAuthorInfo: () => ({ name: "TestUser", avatarUrl: "https://img/me.png" }),
  });

  state = slice;

  return {
    getState: () => state,
    set,
    subscribe,
    setState,
  };
}

describe("event-comments-slice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.feed.getComments.mockResolvedValue([]);
  });

  describe("selectEvent", () => {
    it("sets selectedEventId", () => {
      const store = createTestStore();
      store.getState().selectEvent("evt-1");
      expect(store.getState().selectedEventId).toBe("evt-1");
    });

    it("clears selectedEventId with null", () => {
      const store = createTestStore();
      store.getState().selectEvent("evt-1");
      store.getState().selectEvent(null);
      expect(store.getState().selectedEventId).toBeNull();
    });
  });

  describe("addComment", () => {
    it("adds network comment on API success", async () => {
      const dto = makeCommentDto();
      mockApi.feed.addComment.mockResolvedValue(dto);

      const store = createTestStore();
      store.getState().addComment("evt-1", "Hello!");

      await vi.waitFor(() => {
        expect(store.getState().comments).toHaveLength(1);
      });
      expect(store.getState().comments[0].text).toBe("Hello!");
      expect(store.getState().comments[0].eventId).toBe("evt-1");
    });

    it("falls back to local comment on API failure", async () => {
      mockApi.feed.addComment.mockRejectedValue(new Error("fail"));

      const store = createTestStore();
      store.getState().addComment("evt-2", "Offline comment");

      await vi.waitFor(() => {
        expect(store.getState().comments).toHaveLength(1);
      });
      const comment = store.getState().comments[0];
      expect(comment.text).toBe("Offline comment");
      expect(comment.eventId).toBe("evt-2");
      expect(comment.author.name).toBe("TestUser");
      expect(comment.id).toMatch(/^test-cmt-/);
    });
  });

  describe("setupCommentLoadingSubscription", () => {
    it("loads comments when selectedEventId changes", async () => {
      const dto = makeCommentDto({ id: "loaded-c1" });
      mockApi.feed.getComments.mockResolvedValue([dto]);

      const store = createTestStore();
      setupCommentLoadingSubscription(store.subscribe, store.setState);

      store.getState().selectEvent("evt-1");

      await vi.waitFor(() => {
        expect(store.getState().comments).toHaveLength(1);
      });
      expect(store.getState().comments[0].id).toBe("loaded-c1");
    });

    it("does not reload comments for the same event", async () => {
      mockApi.feed.getComments.mockResolvedValue([]);

      const store = createTestStore();
      setupCommentLoadingSubscription(store.subscribe, store.setState);

      store.getState().selectEvent("evt-1");
      await vi.waitFor(() => {
        expect(mockApi.feed.getComments).toHaveBeenCalledTimes(1);
      });

      store.getState().selectEvent(null);
      store.getState().selectEvent("evt-1");

      // Should still only have 1 call (idempotent)
      expect(mockApi.feed.getComments).toHaveBeenCalledTimes(1);
    });

    it("deduplicates comments that already exist", async () => {
      const dto = makeCommentDto({ id: "dup-c1" });
      mockApi.feed.getComments.mockResolvedValue([dto]);

      const store = createTestStore();
      // Pre-populate with the same comment ID
      store.set({
        comments: [networkCommentToFeedComment(dto)],
      });

      setupCommentLoadingSubscription(store.subscribe, store.setState);
      store.getState().selectEvent("evt-1");

      await vi.waitFor(() => {
        expect(mockApi.feed.getComments).toHaveBeenCalledTimes(1);
      });

      expect(store.getState().comments).toHaveLength(1);
    });
  });

  describe("clearing selection", () => {
    it("returns to initial state when cleared", () => {
      const store = createTestStore();
      store.getState().selectEvent("evt-1");
      expect(store.getState().selectedEventId).toBe("evt-1");

      store.getState().selectEvent(null);
      expect(store.getState().selectedEventId).toBeNull();
    });
  });
});

describe("networkCommentToFeedComment", () => {
  it("maps CommentDto to FeedComment", () => {
    const dto: CommentDto = {
      id: "c1",
      activity_event_id: "evt-1",
      profile_id: "user-1",
      content: "Nice!",
      created_at: "2025-06-01T12:00:00Z",
      author_name: "Alice",
      author_avatar: "https://img/alice.png",
    };
    const result = networkCommentToFeedComment(dto);
    expect(result.id).toBe("c1");
    expect(result.eventId).toBe("evt-1");
    expect(result.text).toBe("Nice!");
    expect(result.author.name).toBe("Alice");
    expect(result.author.avatarUrl).toBe("https://img/alice.png");
  });

  it("falls back to profile_id when author_name is missing", () => {
    const dto: CommentDto = {
      id: "c2",
      activity_event_id: "evt-2",
      profile_id: "user-2",
      content: "Yo",
      created_at: null,
    };
    const result = networkCommentToFeedComment(dto);
    expect(result.author.name).toBe("user-2");
    expect(result.author.avatarUrl).toBeUndefined();
  });
});
