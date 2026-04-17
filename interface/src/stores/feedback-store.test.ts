import { describe, expect, it } from "vitest";
import { sortItems, useFeedbackStore } from "./feedback-store";
import type { FeedbackItem } from "../apps/feedback/types";

function makeItem(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    id: "x",
    author: { name: "x", type: "user" },
    title: "x",
    body: "x",
    category: "feedback",
    status: "not_started",
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

describe("useFeedbackStore", () => {
  it("castVote toggles viewerVote and adjusts aggregates", () => {
    const initial = useFeedbackStore.getState();
    const firstId = initial.items[0]!.id;
    const baseline = initial.items[0]!;

    useFeedbackStore.getState().castVote(firstId, "up");
    const afterUp = useFeedbackStore.getState().items.find((i) => i.id === firstId)!;

    if (baseline.viewerVote === "up") {
      expect(afterUp.viewerVote).toBe("up");
    } else {
      expect(afterUp.viewerVote).toBe("up");
      expect(afterUp.upvotes).toBe(baseline.upvotes + (baseline.viewerVote === "up" ? 0 : 1));
      expect(afterUp.voteScore).toBe(afterUp.upvotes - afterUp.downvotes);
    }

    useFeedbackStore.getState().castVote(firstId, "none");
    const cleared = useFeedbackStore.getState().items.find((i) => i.id === firstId)!;
    expect(cleared.viewerVote).toBe("none");
  });

  it("createFeedback rejects an empty body with a composer error", async () => {
    const created = await useFeedbackStore.getState().createFeedback({
      title: "",
      body: "   ",
      category: "bug",
      status: "not_started",
    });

    expect(created).toBeNull();
    expect(useFeedbackStore.getState().composerError).not.toBeNull();
  });

  it("createFeedback prepends a new item and selects it", async () => {
    const before = useFeedbackStore.getState().items.length;
    const created = await useFeedbackStore.getState().createFeedback({
      title: "Test",
      body: "Body text",
      category: "feedback",
      status: "not_started",
    });

    expect(created).not.toBeNull();
    const state = useFeedbackStore.getState();
    expect(state.items.length).toBe(before + 1);
    expect(state.items[0]!.id).toBe(created!.id);
    expect(state.selectedId).toBe(created!.id);
  });
});
