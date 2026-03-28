import { useCallback } from "react";
import { create } from "zustand";
import { useAuthStore } from "./auth-store";
import { useEventStore } from "./event-store";
import { useFollowStore } from "./follow-store";
import { api } from "../api/client";
import type { FeedEventDto } from "../api/social";
import type { AuraEvent } from "../types/aura-events";
import { EventType } from "../types/aura-events";

export type PostType = "post" | "push" | "event";

export interface FeedCommit {
  sha: string;
  message: string;
}

export interface FeedAuthor {
  name: string;
  avatarUrl?: string;
  type: "user" | "agent";
  status?: string;
}

export interface FeedEvent {
  id: string;
  postType: PostType;
  title: string;
  author: FeedAuthor;
  repo: string;
  branch: string;
  commits: FeedCommit[];
  commitIds: string[];
  pushId?: string;
  timestamp: string;
  summary?: string;
  eventType: string;
  profileId: string;
}

export interface FeedComment {
  id: string;
  eventId: string;
  author: FeedAuthor;
  text: string;
  timestamp: string;
}

export type FeedFilter = "my-agents" | "organization" | "following" | "everything";

export interface FeedSelectedProfile {
  name: string;
  type: "user" | "agent";
  avatarUrl?: string;
  profileId?: string;
}

interface NetworkComment {
  id: string;
  activity_event_id: string;
  profile_id: string;
  content: string;
  created_at: string | null;
}

export function networkEventToFeedEvent(net: FeedEventDto): FeedEvent {
  const meta = net.metadata ?? {};
  const postType = (net.post_type ?? "push") as PostType;
  const title = net.title ?? (meta.summary as string) ?? "";
  const summary = net.summary ?? (meta.summary as string) ?? undefined;

  const authorName = (meta.author_name as string) || (meta.profileName as string) || "Unknown";
  const authorAvatar = (meta.author_avatar as string) || (meta.avatarUrl as string) || undefined;
  const authorType = ((meta.author_type as string) || (meta.profileType as string) || "user") as "user" | "agent";
  const authorStatus = (meta.author_status as string) || (meta.agent_status as string) || undefined;

  const repo = (meta.repo as string) || (meta.repository as string) || "";
  const branch = (meta.branch as string) || "main";
  const rawCommits = (meta.commits as Array<{ sha?: string; message?: string }>) || [];
  const commits: FeedCommit[] = rawCommits.map((c) => ({
    sha: c.sha || "",
    message: c.message || "",
  }));
  const commitIds = net.commit_ids ?? [];
  const pushId = net.push_id ?? undefined;

  return {
    id: net.id,
    postType,
    title,
    author: { name: authorName, avatarUrl: authorAvatar, type: authorType, status: authorStatus },
    repo,
    branch,
    commits,
    commitIds,
    pushId,
    timestamp: net.created_at || new Date().toISOString(),
    summary,
    eventType: net.event_type,
    profileId: net.profile_id,
  };
}

export function networkCommentToFeedComment(net: NetworkComment): FeedComment {
  return {
    id: net.id,
    eventId: net.activity_event_id,
    author: { name: net.profile_id, type: "user" },
    text: net.content,
    timestamp: net.created_at || new Date().toISOString(),
  };
}

function applyFilter(
  events: FeedEvent[],
  filter: FeedFilter,
  followedNames?: Set<string>,
): FeedEvent[] {
  switch (filter) {
    case "my-agents":
      return events.filter((e) => e.author.type === "agent");
    case "following":
      if (!followedNames || followedNames.size === 0) return [];
      return events.filter((e) => followedNames.has(e.profileId));
    case "organization":
    case "everything":
    default:
      return events;
  }
}

function commitActivityFromEvents(events: FeedEvent[]): Record<string, number> {
  const activity: Record<string, number> = {};
  for (const evt of events) {
    if (evt.postType !== "push") continue;
    const ts = new Date(evt.timestamp);
    const dateKey = evt.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    activity[hourKey] = (activity[hourKey] ?? 0) + evt.commits.length;
  }
  return activity;
}

const CURRENT_USER = "real-n3o";

interface FeedState {
  liveEvents: FeedEvent[] | null;
  userAvatarUrl: string | undefined;
  filter: FeedFilter;
  selectedEventId: string | null;
  selectedProfile: FeedSelectedProfile | null;
  comments: FeedComment[];

  setFilter: (f: FeedFilter) => void;
  selectEvent: (id: string | null) => void;
  selectProfile: (profile: FeedSelectedProfile | null) => void;
  addComment: (eventId: string, text: string) => void;
  createPost: (title: string, summary?: string) => Promise<void>;
  init: () => void;
}

let _initialized = false;
let _nextCommentId = 1;
const _seenIds = new Set<string>();
const _loadedCommentIds = new Set<string>();
const _eventUnsubs: (() => void)[] = [];

type FeedSetter = (
  partial: FeedState | Partial<FeedState> | ((state: FeedState) => FeedState | Partial<FeedState>),
) => void;

function handleGitPushed(event: AuraEvent, set: FeedSetter): void {
  if (event.type !== EventType.GitPushed) return;
  const c = event.content;
  const feedEvent: FeedEvent = {
    id: `git-push-${c.spec_id ?? Date.now()}`,
    postType: "push",
    title: c.summary ?? "Code pushed",
    author: { name: "Agent", type: "agent" },
    repo: c.repo ?? "",
    branch: c.branch ?? "main",
    commits: (c.commits ?? []).map((cm) => ({ sha: cm.sha, message: cm.message })),
    commitIds: (c.commits ?? []).map((cm) => cm.sha),
    timestamp: new Date().toISOString(),
    summary: c.summary,
    eventType: "push",
    profileId: "",
  };
  if (_seenIds.has(feedEvent.id)) return;
  _seenIds.add(feedEvent.id);
  set((s) => ({ liveEvents: [feedEvent, ...(s.liveEvents ?? [])] }));
}

function handleNetworkEvent(event: AuraEvent, set: FeedSetter): void {
  if (event.type !== EventType.NetworkEvent) return;
  const payload = event.content.payload;
  if (!payload) return;
  const wsType = (payload.type as string) ?? "";
  if (wsType !== "activity.new") return;
  const data = payload.data as FeedEventDto | undefined;
  if (!data || !data.id) return;
  if (_seenIds.has(data.id)) return;
  _seenIds.add(data.id);
  const feedEvent = networkEventToFeedEvent(data);
  set((s) => ({ liveEvents: [feedEvent, ...(s.liveEvents ?? [])] }));
}

export const useFeedStore = create<FeedState>()((set, get) => ({
  liveEvents: null,
  userAvatarUrl: undefined,
  filter: "everything",
  selectedEventId: null,
  selectedProfile: null,
  comments: [],

  setFilter: (f) => set({ filter: f }),

  selectEvent: (id) => {
    set({ selectedEventId: id });
    if (id) set({ selectedProfile: null });
  },

  selectProfile: (profile) => {
    set({ selectedProfile: profile });
    if (profile) set({ selectedEventId: null });
  },

  addComment: (eventId, text) => {
    const user = useAuthStore.getState().user;
    const { userAvatarUrl } = get();
    const currentUserAvatar =
      userAvatarUrl ||
      (user?.profile_image && user.profile_image.startsWith("http") ? user.profile_image : undefined);
    const authorName = user?.display_name || CURRENT_USER;
    const makeLocal = (): FeedComment => ({
      id: `cmt-${_nextCommentId++}`,
      eventId,
      author: { name: authorName, type: "user", avatarUrl: currentUserAvatar },
      text,
      timestamp: new Date().toISOString(),
    });

    api.feed
      .addComment(eventId, text)
      .then((net) => {
        set((s) => ({ comments: [...s.comments, networkCommentToFeedComment(net)] }));
      })
      .catch(() => {
        set((s) => ({ comments: [...s.comments, makeLocal()] }));
      });
  },

  createPost: async (title, summary) => {
    const post = await api.feed.createPost({ title, summary, post_type: "post" });
    const feedEvent = networkEventToFeedEvent(post);
    _seenIds.add(feedEvent.id);
    set((s) => ({ liveEvents: [feedEvent, ...(s.liveEvents ?? [])] }));
  },

  init: () => {
    if (_initialized) return;
    _initialized = true;

    api.feed
      .list()
      .then((netEvents) => {
        const mapped = netEvents.map(networkEventToFeedEvent);
        for (const e of mapped) _seenIds.add(e.id);
        set({ liveEvents: mapped });
      })
      .catch(() => set({ liveEvents: [] }));

    api.users
      .me()
      .then((u) => { if (u.avatar_url) set({ userAvatarUrl: u.avatar_url }); })
      .catch(() => {});

    const { subscribe } = useEventStore.getState();
    _eventUnsubs.push(subscribe(EventType.GitPushed, (e) => handleGitPushed(e, set)));
    _eventUnsubs.push(subscribe(EventType.NetworkEvent, (e) => handleNetworkEvent(e, set)));
  },
}));

/** Load comments for the selected event (idempotent per eventId). */
useFeedStore.subscribe((state, prev) => {
  const eventId = state.selectedEventId;
  if (!eventId || eventId === prev.selectedEventId) return;
  if (_loadedCommentIds.has(eventId)) return;
  _loadedCommentIds.add(eventId);

  api.feed
    .getComments(eventId)
    .then((netComments) => {
      const mapped = netComments.map(networkCommentToFeedComment);
      if (mapped.length > 0) {
        useFeedStore.setState((s) => {
          const existingIds = new Set(s.comments.map((c) => c.id));
          const fresh = mapped.filter((c) => !existingIds.has(c.id));
          return fresh.length > 0 ? { comments: [...s.comments, ...fresh] } : {};
        });
      }
    })
    .catch(() => {});
});

/* ── derived selectors ── */

export function useFeedEvents(): FeedEvent[] {
  const liveEvents = useFeedStore((s) => s.liveEvents);
  const userAvatarUrl = useFeedStore((s) => s.userAvatarUrl);
  const user = useAuthStore((s) => s.user);
  const currentUserAvatar =
    userAvatarUrl ||
    (user?.profile_image && user.profile_image.startsWith("http") ? user.profile_image : undefined);
  const currentUserName = user?.display_name;

  const source = liveEvents ?? [];
  return [...source]
    .map((evt) => {
      if (currentUserAvatar && evt.author.type === "user" && evt.author.name === CURRENT_USER) {
        return { ...evt, author: { ...evt.author, name: currentUserName || evt.author.name, avatarUrl: currentUserAvatar } };
      }
      return evt;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function useFeedFilteredEvents(): FeedEvent[] {
  const events = useFeedEvents();
  const filter = useFeedStore((s) => s.filter);
  const follows = useFollowStore((s) => s.follows);

  const followedNames = new Set(follows.map((f) => f.target_profile_id));
  return applyFilter(events, filter, followedNames);
}

export function useFeedCommitActivity(): Record<string, number> {
  const filteredEvents = useFeedFilteredEvents();
  return commitActivityFromEvents(filteredEvents);
}

export function useFeedCommentsForEvent(eventId: string | null): FeedComment[] {
  const comments = useFeedStore((s) => s.comments);
  if (!eventId) return [];
  return comments
    .filter((c) => c.eventId === eventId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Drop-in replacement for the old useFeed() context hook.
 * Includes derived values so consumers need only an import-path change.
 */
export function useFeed() {
  const filter = useFeedStore((s) => s.filter);
  const setFilter = useFeedStore((s) => s.setFilter);
  const selectedEventId = useFeedStore((s) => s.selectedEventId);
  const selectEvent = useFeedStore((s) => s.selectEvent);
  const selectedProfile = useFeedStore((s) => s.selectedProfile);
  const selectProfile = useFeedStore((s) => s.selectProfile);
  const addComment = useFeedStore((s) => s.addComment);
  const createPost = useFeedStore((s) => s.createPost);
  const comments = useFeedStore((s) => s.comments);

  const events = useFeedEvents();
  const filteredEvents = useFeedFilteredEvents();
  const commitActivity = useFeedCommitActivity();

  const getCommentsForEvent = useCallback(
    (eventId: string) =>
      comments
        .filter((c) => c.eventId === eventId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [comments],
  );

  return {
    events,
    filteredEvents,
    commitActivity,
    filter,
    setFilter,
    selectedEventId,
    selectEvent,
    selectedProfile,
    selectProfile,
    getCommentsForEvent,
    addComment,
    createPost,
  };
}
