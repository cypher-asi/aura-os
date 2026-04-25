import { api } from "../../api/client";
import type { CommentDto } from "../../shared/api/social";

/* ── Shared types ── */

export interface FeedAuthor {
  name: string;
  avatarUrl?: string;
  type: "user" | "agent";
  status?: string;
}

export interface FeedComment {
  id: string;
  eventId: string;
  author: FeedAuthor;
  text: string;
  timestamp: string;
}

/* ── Converters ── */

export function networkCommentToFeedComment(net: CommentDto): FeedComment {
  return {
    id: net.id,
    eventId: net.activity_event_id,
    author: {
      name: net.author_name || net.profile_id,
      type: "user",
      avatarUrl: net.author_avatar || undefined,
    },
    text: net.content,
    timestamp: net.created_at || new Date().toISOString(),
  };
}

/* ── Slice types ── */

export interface EventCommentsState {
  selectedEventId: string | null;
  comments: FeedComment[];
}

export interface EventCommentsActions {
  selectEvent: (id: string | null) => void;
  addComment: (eventId: string, text: string) => void;
}

export type EventCommentsSlice = EventCommentsState & EventCommentsActions;

export interface EventCommentsConfig {
  getAuthorInfo: () => { name: string; avatarUrl?: string };
  idPrefix: string;
}

let _nextCommentId = 1;

/**
 * Create the shared event-comment state and actions for a zustand store.
 *
 * The returned object is meant to be spread into the store creator.
 * Pass a store-specific `config` to customise author resolution and
 * local-comment ID prefixes (avoids collisions between stores).
 */
export function createEventCommentsSlice<S extends EventCommentsState>(
  set: (
    partial:
      | Partial<EventCommentsState>
      | ((state: S) => Partial<EventCommentsState>),
  ) => void,
  config: EventCommentsConfig,
): EventCommentsSlice {
  return {
    selectedEventId: null,
    comments: [],

    selectEvent: (id) => set({ selectedEventId: id }),

    addComment: (eventId, text) => {
      const { name, avatarUrl } = config.getAuthorInfo();
      const makeLocal = (): FeedComment => ({
        id: `${config.idPrefix}-${_nextCommentId++}`,
        eventId,
        author: { name, type: "user", avatarUrl },
        text,
        timestamp: new Date().toISOString(),
      });

      api.feed
        .addComment(eventId, text)
        .then((net) => {
          set((s) => ({
            comments: [...s.comments, networkCommentToFeedComment(net)],
          }));
        })
        .catch(() => {
          set((s) => ({ comments: [...s.comments, makeLocal()] }));
        });
    },
  };
}

/**
 * Subscribe to `selectedEventId` changes and auto-load comments from the
 * API.  Each event's comments are fetched at most once (idempotent).
 *
 * Returns an unsubscribe function.
 */
export function setupCommentLoadingSubscription<S extends EventCommentsState>(
  subscribe: (
    listener: (state: S, prev: S) => void,
  ) => () => void,
  setState: (
    updater: (state: S) => Partial<S>,
  ) => void,
): () => void {
  const loadedIds = new Set<string>();

  return subscribe((state, prev) => {
    const eventId = state.selectedEventId;
    if (!eventId || eventId === prev.selectedEventId) return;
    if (loadedIds.has(eventId)) return;
    loadedIds.add(eventId);

    api.feed
      .getComments(eventId)
      .then((netComments) => {
        const mapped = netComments.map(networkCommentToFeedComment);
        if (mapped.length > 0) {
          setState((s) => {
            const existingIds = new Set(s.comments.map((c) => c.id));
            const fresh = mapped.filter((c) => !existingIds.has(c.id));
            return (
              fresh.length > 0
                ? { comments: [...s.comments, ...fresh] }
                : {}
            ) as Partial<S>;
          });
        }
      })
      .catch(() => {});
  });
}
