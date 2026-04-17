import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "./auth-store";
import {
  MOCK_FEEDBACK_COMMENTS,
  MOCK_FEEDBACK_ITEMS,
} from "../apps/feedback/mock-data";
import type {
  FeedbackAuthor,
  FeedbackCategory,
  FeedbackComment,
  FeedbackDraft,
  FeedbackItem,
  FeedbackSort,
  FeedbackStatus,
  ViewerVote,
} from "../apps/feedback/types";

interface FeedbackState {
  items: readonly FeedbackItem[];
  comments: readonly FeedbackComment[];
  sort: FeedbackSort;
  categoryFilter: FeedbackCategory | null;
  statusFilter: FeedbackStatus | null;
  selectedId: string | null;
  isSubmitting: boolean;
  composerError: string | null;
}

interface FeedbackActions {
  setSort: (sort: FeedbackSort) => void;
  setCategoryFilter: (category: FeedbackCategory | null) => void;
  setStatusFilter: (status: FeedbackStatus | null) => void;
  selectItem: (id: string | null) => void;
  createFeedback: (draft: FeedbackDraft) => Promise<FeedbackItem | null>;
  castVote: (id: string, vote: ViewerVote) => void;
  setStatus: (id: string, status: FeedbackStatus) => void;
  addComment: (itemId: string, text: string) => void;
  resetComposerError: () => void;
}

type FeedbackStore = FeedbackState & FeedbackActions;

function currentAuthor(): FeedbackAuthor {
  const user = useAuthStore.getState().user;
  return {
    name: user?.display_name ?? "You",
    type: "user",
    avatarUrl: user?.profile_image ?? undefined,
  };
}

function validateDraft(draft: FeedbackDraft): string | null {
  if (!draft.body.trim()) return "Please write your feedback before submitting.";
  if (draft.title && draft.title.length > 160) return "Title must be 160 characters or fewer.";
  if (draft.body.length > 4000) return "Body must be 4000 characters or fewer.";
  return null;
}

let nextLocalId = 1;
function newId(prefix: string): string {
  return `${prefix}-local-${nextLocalId++}`;
}

function applyVote(item: FeedbackItem, next: ViewerVote): FeedbackItem {
  if (item.viewerVote === next) return item;

  let upvotes = item.upvotes;
  let downvotes = item.downvotes;

  if (item.viewerVote === "up") upvotes -= 1;
  if (item.viewerVote === "down") downvotes -= 1;
  if (next === "up") upvotes += 1;
  if (next === "down") downvotes += 1;

  return {
    ...item,
    upvotes,
    downvotes,
    voteScore: upvotes - downvotes,
    viewerVote: next,
  };
}

export const useFeedbackStore = create<FeedbackStore>()((set) => ({
  items: MOCK_FEEDBACK_ITEMS,
  comments: MOCK_FEEDBACK_COMMENTS,
  sort: "latest",
  categoryFilter: null,
  statusFilter: null,
  selectedId: null,
  isSubmitting: false,
  composerError: null,

  setSort: (sort) => set({ sort }),

  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),

  setStatusFilter: (statusFilter) => set({ statusFilter }),

  selectItem: (id) => set({ selectedId: id }),

  resetComposerError: () => set({ composerError: null }),

  createFeedback: async (draft) => {
    const error = validateDraft(draft);
    if (error) {
      set({ composerError: error });
      return null;
    }

    set({ isSubmitting: true, composerError: null });

    const item: FeedbackItem = {
      id: newId("fb"),
      author: currentAuthor(),
      title: draft.title.trim() || draft.body.trim().slice(0, 80),
      body: draft.body.trim(),
      category: draft.category,
      status: draft.status,
      upvotes: 0,
      downvotes: 0,
      voteScore: 0,
      viewerVote: "none",
      commentCount: 0,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      items: [item, ...state.items],
      isSubmitting: false,
      selectedId: item.id,
    }));

    return item;
  },

  castVote: (id, vote) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? applyVote(item, vote) : item,
      ),
    })),

  setStatus: (id, status) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    })),

  addComment: (itemId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const comment: FeedbackComment = {
      id: newId("cm"),
      itemId,
      author: currentAuthor(),
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      comments: [...state.comments, comment],
      items: state.items.map((item) =>
        item.id === itemId
          ? { ...item, commentCount: item.commentCount + 1 }
          : item,
      ),
    }));
  },
}));

function hoursBetween(nowMs: number, iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (nowMs - t) / (1000 * 60 * 60));
}

export function sortItems(
  items: readonly FeedbackItem[],
  sort: FeedbackSort,
  nowMs: number = Date.now(),
): readonly FeedbackItem[] {
  const copy = [...items];

  switch (sort) {
    case "latest":
      return copy.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case "most_voted":
      return copy.sort((a, b) => b.voteScore - a.voteScore);
    case "least_voted":
      return copy.sort((a, b) => a.voteScore - b.voteScore);
    case "popular":
      return copy.sort(
        (a, b) =>
          b.voteScore + b.commentCount - (a.voteScore + a.commentCount),
      );
    case "trending": {
      const score = (i: FeedbackItem): number => {
        const age = hoursBetween(nowMs, i.createdAt);
        return (i.voteScore + i.commentCount) / Math.pow(age + 2, 1.5);
      };
      return copy.sort((a, b) => score(b) - score(a));
    }
  }
}

export function useFeedback() {
  return useFeedbackStore(
    useShallow((s) => ({
      items: s.items,
      sort: s.sort,
      setSort: s.setSort,
      categoryFilter: s.categoryFilter,
      setCategoryFilter: s.setCategoryFilter,
      statusFilter: s.statusFilter,
      setStatusFilter: s.setStatusFilter,
      selectedId: s.selectedId,
      selectItem: s.selectItem,
      isSubmitting: s.isSubmitting,
      composerError: s.composerError,
      createFeedback: s.createFeedback,
      castVote: s.castVote,
      setStatus: s.setStatus,
      resetComposerError: s.resetComposerError,
    })),
  );
}

export function useSortedFeedbackItems(): readonly FeedbackItem[] {
  const items = useFeedbackStore((s) => s.items);
  const sort = useFeedbackStore((s) => s.sort);
  const categoryFilter = useFeedbackStore((s) => s.categoryFilter);
  const statusFilter = useFeedbackStore((s) => s.statusFilter);
  return useMemo(() => {
    const filtered = items.filter(
      (item) =>
        (categoryFilter === null || item.category === categoryFilter) &&
        (statusFilter === null || item.status === statusFilter),
    );
    return sortItems(filtered, sort);
  }, [items, sort, categoryFilter, statusFilter]);
}

export function useFeedbackComments(itemId: string | null): readonly FeedbackComment[] {
  return useFeedbackStore(
    useShallow((s) =>
      itemId === null ? [] : s.comments.filter((c) => c.itemId === itemId),
    ),
  );
}

export function useFeedbackItem(id: string | null): FeedbackItem | null {
  return useFeedbackStore((s) =>
    id === null ? null : (s.items.find((i) => i.id === id) ?? null),
  );
}

export function useAddFeedbackComment(): (itemId: string, text: string) => void {
  return useFeedbackStore((s) => s.addComment);
}
