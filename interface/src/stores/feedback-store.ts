import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import type {
  FeedbackCommentDto,
  FeedbackItemDto,
  FeedbackVoteResultDto,
} from "../api/feedback";
import { useAuthStore } from "./auth-store";
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
  isLoading: boolean;
  loadError: string | null;
  isSubmitting: boolean;
  composerError: string | null;
  /** item IDs for which we've already fetched comments at least once. */
  commentsLoadedFor: Set<string>;
}

interface FeedbackActions {
  setSort: (sort: FeedbackSort) => void;
  setCategoryFilter: (category: FeedbackCategory | null) => void;
  setStatusFilter: (status: FeedbackStatus | null) => void;
  selectItem: (id: string | null) => void;
  loadItems: () => Promise<void>;
  loadComments: (itemId: string) => Promise<void>;
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

function dtoToItem(dto: FeedbackItemDto): FeedbackItem {
  return {
    id: dto.id,
    author: {
      name: dto.authorName ?? "Unknown",
      avatarUrl: dto.authorAvatar ?? undefined,
      type: "user",
    },
    title: dto.title ?? "",
    body: dto.summary ?? "",
    category: dto.category,
    status: dto.status,
    upvotes: dto.upvotes,
    downvotes: dto.downvotes,
    voteScore: dto.voteScore,
    viewerVote: dto.viewerVote,
    commentCount: dto.commentCount,
    createdAt: dto.createdAt ?? new Date().toISOString(),
  };
}

function dtoToComment(dto: FeedbackCommentDto): FeedbackComment {
  return {
    id: dto.id,
    itemId: dto.activityEventId,
    author: {
      name: dto.authorName ?? "Unknown",
      avatarUrl: dto.authorAvatar ?? undefined,
      type: "user",
    },
    text: dto.content,
    createdAt: dto.createdAt ?? new Date().toISOString(),
  };
}

function validateDraft(draft: FeedbackDraft): string | null {
  if (!draft.body.trim()) return "Please write your feedback before submitting.";
  if (draft.title && draft.title.length > 160) return "Title must be 160 characters or fewer.";
  if (draft.body.length > 4000) return "Body must be 4000 characters or fewer.";
  return null;
}

let nextLocalId = 1;
function newLocalId(prefix: string): string {
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

export const useFeedbackStore = create<FeedbackStore>()((set, get) => ({
  items: [],
  comments: [],
  sort: "latest",
  categoryFilter: null,
  statusFilter: null,
  selectedId: null,
  isLoading: false,
  loadError: null,
  isSubmitting: false,
  composerError: null,
  commentsLoadedFor: new Set<string>(),

  setSort: (sort) => set({ sort }),

  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),

  setStatusFilter: (statusFilter) => set({ statusFilter }),

  selectItem: (id) => {
    set({ selectedId: id });
    if (id) {
      void get().loadComments(id);
    }
  },

  resetComposerError: () => set({ composerError: null }),

  loadItems: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const dtos = await api.feedback.list();
      set({ items: dtos.map(dtoToItem), isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        loadError: err instanceof Error ? err.message : "Failed to load feedback.",
      });
    }
  },

  loadComments: async (itemId) => {
    if (get().commentsLoadedFor.has(itemId)) return;
    try {
      const dtos = await api.feedback.listComments(itemId);
      const fresh = dtos.map(dtoToComment);
      set((state) => {
        const existingIds = new Set(state.comments.map((c) => c.id));
        const merged = [
          ...state.comments,
          ...fresh.filter((c) => !existingIds.has(c.id)),
        ];
        const loaded = new Set(state.commentsLoadedFor);
        loaded.add(itemId);
        return { comments: merged, commentsLoadedFor: loaded };
      });
    } catch {
      // Leaving commentsLoadedFor untouched means the UI will retry on the
      // next selection. The sidekick empty-state remains correct either way.
    }
  },

  createFeedback: async (draft) => {
    const error = validateDraft(draft);
    if (error) {
      set({ composerError: error });
      return null;
    }

    set({ isSubmitting: true, composerError: null });
    try {
      const dto = await api.feedback.create({
        title: draft.title.trim() || undefined,
        body: draft.body.trim(),
        category: draft.category,
        status: draft.status,
      });
      const item = dtoToItem(dto);
      set((state) => ({
        items: [item, ...state.items],
        isSubmitting: false,
        selectedId: item.id,
      }));
      return item;
    } catch (err) {
      set({
        isSubmitting: false,
        composerError: err instanceof Error ? err.message : "Failed to post feedback.",
      });
      return null;
    }
  },

  castVote: (id, vote) => {
    // Snapshot the current row so we can revert if the API call fails.
    const previous = get().items.find((item) => item.id === id);
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? applyVote(item, vote) : item)),
    }));

    api.feedback
      .castVote(id, vote)
      .then((result: FeedbackVoteResultDto) => {
        // Reconcile with server aggregates so totals (across other viewers)
        // and our own vote state end up consistent.
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  upvotes: result.upvotes,
                  downvotes: result.downvotes,
                  voteScore: result.voteScore,
                  viewerVote: result.viewerVote,
                }
              : item,
          ),
        }));
      })
      .catch((err) => {
        console.warn("feedback vote failed", err);
        if (!previous) return;
        set((state) => ({
          items: state.items.map((item) => (item.id === id ? previous : item)),
        }));
      });
  },

  setStatus: (id, status) => {
    const previous = get().items.find((item) => item.id === id);
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    }));

    api.feedback
      .updateStatus(id, status)
      .then((dto) => {
        const reconciled = dtoToItem(dto);
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? reconciled : item,
          ),
        }));
      })
      .catch((err) => {
        console.warn("feedback status update failed", err);
        if (!previous) return;
        set((state) => ({
          items: state.items.map((item) => (item.id === id ? previous : item)),
        }));
      });
  },

  addComment: (itemId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const optimistic: FeedbackComment = {
      id: newLocalId("cm"),
      itemId,
      author: currentAuthor(),
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      comments: [...state.comments, optimistic],
      items: state.items.map((item) =>
        item.id === itemId
          ? { ...item, commentCount: item.commentCount + 1 }
          : item,
      ),
    }));

    api.feedback
      .addComment(itemId, trimmed)
      .then((dto) => {
        const real = dtoToComment(dto);
        set((state) => ({
          comments: state.comments.map((c) => (c.id === optimistic.id ? real : c)),
        }));
      })
      .catch((err) => {
        console.warn("feedback add comment failed", err);
        set((state) => ({
          comments: state.comments.filter((c) => c.id !== optimistic.id),
          items: state.items.map((item) =>
            item.id === itemId
              ? { ...item, commentCount: Math.max(0, item.commentCount - 1) }
              : item,
          ),
        }));
      });
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
      isLoading: s.isLoading,
      loadError: s.loadError,
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

/**
 * Bootstraps the feedback list on mount. Call once from a component that
 * lives for the lifetime of the Feedback app (e.g. the main panel).
 */
export function useFeedbackBootstrap(): void {
  const loadItems = useFeedbackStore((s) => s.loadItems);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);
}
