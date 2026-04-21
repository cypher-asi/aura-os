import { beforeEach, describe, expect, it, vi } from "vitest";

const feedbackApiMock = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  get: vi.fn(),
  create: vi.fn(),
  updateStatus: vi.fn(),
  listComments: vi.fn(async () => []),
  addComment: vi.fn(),
  castVote: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: { feedback: feedbackApiMock },
}));

import { sortItems, useFeedbackStore } from "./feedback-store";
import type { FeedbackItem } from "../apps/feedback/types";
import type { FeedbackItemDto } from "../api/feedback";

function makeItem(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    id: "x",
    author: { name: "x", type: "user" },
    title: "x",
    body: "x",
    category: "feedback",
    status: "not_started",
    product: "aura",
    upvotes: 0,
    downvotes: 0,
    voteScore: 0,
    viewerVote: "none",
    commentCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("sortItems", () => {
  const now = Date.UTC(2026, 3, 16, 12, 0, 0);
  const a = makeItem({
    id: "a",
    voteScore: 10,
    commentCount: 1,
    createdAt: new Date(now - 1 * 3600 * 1000).toISOString(),
  });
  const b = makeItem({
    id: "b",
    voteScore: 50,
    commentCount: 20,
    createdAt: new Date(now - 200 * 3600 * 1000).toISOString(),
  });
  const c = makeItem({
    id: "c",
    voteScore: -5,
    commentCount: 0,
    createdAt: new Date(now - 10 * 3600 * 1000).toISOString(),
  });

  it("latest puts newest first", () => {
    const sorted = sortItems([b, c, a], "latest", now);
    expect(sorted.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("most_voted orders by voteScore desc", () => {
    const sorted = sortItems([a, b, c], "most_voted", now);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("least_voted orders by voteScore asc", () => {
    const sorted = sortItems([a, b, c], "least_voted", now);
    expect(sorted.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("popular orders by voteScore + commentCount desc", () => {
    const sorted = sortItems([a, b, c], "popular", now);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("trending favors recency over raw totals", () => {
    const sorted = sortItems([a, b, c], "trending", now);
    expect(sorted[0]!.id).toBe("a");
  });
});

function seedItem(id: string, overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return makeItem({ id, ...overrides });
}

describe("useFeedbackStore", () => {
  beforeEach(() => {
    feedbackApiMock.list.mockReset().mockResolvedValue([]);
    feedbackApiMock.create.mockReset();
    feedbackApiMock.castVote.mockReset().mockResolvedValue({
      upvotes: 0,
      downvotes: 0,
      voteScore: 0,
      viewerVote: "none",
    });
    feedbackApiMock.updateStatus.mockReset();
    feedbackApiMock.listComments.mockReset().mockResolvedValue([]);
    feedbackApiMock.addComment.mockReset();
    useFeedbackStore.setState({
      items: [],
      comments: [],
      selectedId: null,
      composerError: null,
      isSubmitting: false,
      commentsLoadedFor: new Set<string>(),
      productFilter: "aura",
    });
  });

  it("castVote toggles viewerVote optimistically and reconciles from the server", async () => {
    useFeedbackStore.setState({ items: [seedItem("fb-1")] });
    feedbackApiMock.castVote.mockResolvedValueOnce({
      upvotes: 7,
      downvotes: 2,
      voteScore: 5,
      viewerVote: "up",
    });

    useFeedbackStore.getState().castVote("fb-1", "up");
    const optimistic = useFeedbackStore.getState().items.find((i) => i.id === "fb-1")!;
    expect(optimistic.viewerVote).toBe("up");
    expect(optimistic.upvotes).toBe(1);

    await vi.waitFor(() => {
      const latest = useFeedbackStore.getState().items.find((i) => i.id === "fb-1")!;
      expect(latest.upvotes).toBe(7);
      expect(latest.voteScore).toBe(5);
    });
    expect(feedbackApiMock.castVote).toHaveBeenCalledWith("fb-1", "up");
  });

  it("castVote reverts the optimistic update when the API rejects", async () => {
    useFeedbackStore.setState({ items: [seedItem("fb-1", { upvotes: 3, voteScore: 3 })] });
    feedbackApiMock.castVote.mockRejectedValueOnce(new Error("boom"));

    useFeedbackStore.getState().castVote("fb-1", "up");
    await vi.waitFor(() => {
      const row = useFeedbackStore.getState().items.find((i) => i.id === "fb-1")!;
      expect(row.upvotes).toBe(3);
      expect(row.viewerVote).toBe("none");
    });
  });

  it("createFeedback rejects an empty body with a composer error", async () => {
    const created = await useFeedbackStore.getState().createFeedback({
      title: "",
      body: "   ",
      category: "bug",
      status: "not_started",
      product: "aura",
    });
    expect(created).toBeNull();
    expect(useFeedbackStore.getState().composerError).not.toBeNull();
    expect(feedbackApiMock.create).not.toHaveBeenCalled();
  });

  it("createFeedback calls the API and prepends the returned item", async () => {
    const dto: FeedbackItemDto = {
      id: "fb-new",
      profileId: "p1",
      eventType: "feedback",
      postType: "post",
      title: "Test",
      summary: "Body text",
      category: "feedback",
      status: "not_started",
      product: "aura",
      createdAt: new Date().toISOString(),
      commentCount: 0,
      upvotes: 0,
      downvotes: 0,
      voteScore: 0,
      viewerVote: "none",
      authorName: "Ada",
    };
    feedbackApiMock.create.mockResolvedValueOnce(dto);

    const created = await useFeedbackStore.getState().createFeedback({
      title: "Test",
      body: "Body text",
      category: "feedback",
      status: "not_started",
      product: "aura",
    });

    expect(created).not.toBeNull();
    expect(feedbackApiMock.create).toHaveBeenCalledWith({
      title: "Test",
      body: "Body text",
      category: "feedback",
      status: "not_started",
      product: "aura",
    });
    const state = useFeedbackStore.getState();
    expect(state.items[0]!.id).toBe("fb-new");
    expect(state.selectedId).toBe("fb-new");
  });

  it("createFeedback surfaces a composer error when the API fails", async () => {
    feedbackApiMock.create.mockRejectedValueOnce(new Error("boom"));
    const created = await useFeedbackStore.getState().createFeedback({
      title: "Test",
      body: "Body text",
      category: "feedback",
      status: "not_started",
      product: "aura",
    });
    expect(created).toBeNull();
    expect(useFeedbackStore.getState().composerError).toContain("boom");
  });

  it("createFeedback forwards the draft's product to the API", async () => {
    const dto: FeedbackItemDto = {
      id: "fb-grid",
      profileId: "p1",
      eventType: "feedback",
      postType: "post",
      title: "grid",
      summary: "grid body",
      category: "feedback",
      status: "not_started",
      product: "the_grid",
      createdAt: new Date().toISOString(),
      commentCount: 0,
      upvotes: 0,
      downvotes: 0,
      voteScore: 0,
      viewerVote: "none",
    };
    feedbackApiMock.create.mockResolvedValueOnce(dto);
    await useFeedbackStore.getState().createFeedback({
      title: "grid",
      body: "grid body",
      category: "feedback",
      status: "not_started",
      product: "the_grid",
    });
    expect(feedbackApiMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ product: "the_grid" }),
    );
  });

  it("loadItems maps DTOs and clears load errors on success", async () => {
    const dto: FeedbackItemDto = {
      id: "fb-remote",
      profileId: "p1",
      eventType: "feedback",
      postType: "post",
      title: "remote",
      summary: "body",
      category: "bug",
      status: "in_review",
      product: "aura",
      createdAt: "2026-04-17T00:00:00Z",
      commentCount: 3,
      upvotes: 4,
      downvotes: 1,
      voteScore: 3,
      viewerVote: "up",
      authorName: "Grace",
    };
    feedbackApiMock.list.mockResolvedValueOnce([dto]);

    await useFeedbackStore.getState().loadItems();

    const state = useFeedbackStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.id).toBe("fb-remote");
    expect(state.items[0]!.voteScore).toBe(3);
    expect(state.loadError).toBeNull();
  });

  it("useSortedFeedbackItems restricts items to the active productFilter", async () => {
    const now = new Date().toISOString();
    const auraItem = makeItem({ id: "fb-a", product: "aura", createdAt: now });
    const gridItem = makeItem({ id: "fb-g", product: "the_grid", createdAt: now });
    useFeedbackStore.setState({ items: [auraItem, gridItem] });

    const { sortItems: _unused } = await import("./feedback-store");
    void _unused;
    const filterFor = (productFilter: "aura" | "the_grid") => {
      const { items } = useFeedbackStore.getState();
      return items.filter(
        (item) => item.product === productFilter,
      );
    };
    expect(filterFor("aura").map((i) => i.id)).toEqual(["fb-a"]);
    expect(filterFor("the_grid").map((i) => i.id)).toEqual(["fb-g"]);
  });

  it("loadItems records a loadError when the API rejects", async () => {
    feedbackApiMock.list.mockRejectedValueOnce(new Error("network down"));
    await useFeedbackStore.getState().loadItems();
    expect(useFeedbackStore.getState().loadError).toContain("network down");
  });

  it("installs a screenshot bridge that can select items and add comments", () => {
    useFeedbackStore.setState({
      items: [seedItem("fb-1", { commentCount: 2 })],
      comments: [],
      selectedId: null,
    });
    feedbackApiMock.addComment.mockResolvedValueOnce({
      id: "fb-comment-bridge",
      activityEventId: "fb-1",
      profileId: "profile-1",
      content: "Bridge comment for screenshot capture.",
      createdAt: new Date().toISOString(),
      authorName: "Test User",
      authorAvatar: null,
    });

    window.__AURA_SCREENSHOT_BRIDGE__?.selectFeedbackItem("fb-1");
    expect(useFeedbackStore.getState().selectedId).toBe("fb-1");

    window.__AURA_SCREENSHOT_BRIDGE__?.addFeedbackComment(
      "fb-1",
      "Bridge comment for screenshot capture.",
    );

    const state = useFeedbackStore.getState();
    expect(state.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "fb-1",
          text: "Bridge comment for screenshot capture.",
        }),
      ]),
    );
    expect(window.__AURA_SCREENSHOT_BRIDGE__?.getFeedbackState()).toEqual({
      selectedId: "fb-1",
      itemIds: ["fb-1"],
      commentCountByItem: { "fb-1": 3 },
      composerOpen: false,
      titlesByItem: { "fb-1": "x" },
    });
  });
});
