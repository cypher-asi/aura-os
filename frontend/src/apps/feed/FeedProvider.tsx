/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { useEventContext } from "../../context/EventContext";
import { useFollow } from "../../context/FollowContext";
import { api } from "../../api/client";
import type { EngineEvent } from "../../types/events";

export interface FeedCommit {
  sha: string;
  message: string;
}

export interface FeedEvent {
  id: string;
  author: { name: string; avatarUrl?: string; type: "user" | "agent" };
  repo: string;
  branch: string;
  commits: FeedCommit[];
  timestamp: string;
  summary?: string;
}

export interface FeedComment {
  id: string;
  eventId: string;
  author: { name: string; avatarUrl?: string; type: "user" | "agent" };
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

interface FeedContextValue {
  events: FeedEvent[];
  filteredEvents: FeedEvent[];
  commitActivity: Record<string, number>;
  filter: FeedFilter;
  setFilter: (filter: FeedFilter) => void;
  selectedEventId: string | null;
  selectEvent: (id: string | null) => void;
  selectedProfile: FeedSelectedProfile | null;
  selectProfile: (profile: FeedSelectedProfile | null) => void;
  getCommentsForEvent: (eventId: string) => FeedComment[];
  addComment: (eventId: string, text: string) => void;
}

const FeedCtx = createContext<FeedContextValue | null>(null);

const CURRENT_USER = "real-n3o";

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
      return events.filter((e) => followedNames.has(e.author.name));
    case "organization":
    case "everything":
    default:
      return events;
  }
}

function commitActivityFromEvents(events: FeedEvent[]): Record<string, number> {
  const activity: Record<string, number> = {};
  for (const evt of events) {
    const ts = new Date(evt.timestamp);
    const dateKey = evt.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    activity[hourKey] = (activity[hourKey] ?? 0) + evt.commits.length;
  }
  return activity;
}

interface NetworkFeedEvent {
  id: string;
  profile_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

function networkEventToFeedEvent(net: NetworkFeedEvent): FeedEvent {
  const meta = net.metadata ?? {};
  const authorName = (meta.author_name as string) || (meta.profileName as string) || "Unknown";
  const authorAvatar = (meta.author_avatar as string) || (meta.avatarUrl as string) || undefined;
  const authorType = ((meta.author_type as string) || (meta.profileType as string) || "user") as "user" | "agent";
  const repo = (meta.repo as string) || (meta.repository as string) || "";
  const branch = (meta.branch as string) || "main";
  const rawCommits = (meta.commits as Array<{ sha?: string; message?: string }>) || [];
  const commits: FeedCommit[] = rawCommits.map((c) => ({
    sha: c.sha || "",
    message: c.message || "",
  }));
  const summary = (meta.summary as string) || undefined;

  return {
    id: net.id,
    author: { name: authorName, avatarUrl: authorAvatar, type: authorType },
    repo,
    branch,
    commits,
    timestamp: net.created_at || new Date().toISOString(),
    summary,
  };
}

interface NetworkComment {
  id: string;
  activity_event_id: string;
  profile_id: string;
  content: string;
  created_at: string | null;
}

function networkCommentToFeedComment(net: NetworkComment): FeedComment {
  return {
    id: net.id,
    eventId: net.activity_event_id,
    author: { name: net.profile_id, type: "user" },
    text: net.content,
    timestamp: net.created_at || new Date().toISOString(),
  };
}

let nextCommentId = 1;

export function FeedProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { subscribe } = useEventContext();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<FeedSelectedProfile | null>(null);
  const [filter, setFilterRaw] = useState<FeedFilter>("my-agents");
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [liveEvents, setLiveEvents] = useState<FeedEvent[] | null>(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | undefined>(undefined);
  const { follows } = useFollow();
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api.feed
      .list()
      .then((netEvents) => {
        if (cancelled) return;
        const mapped = netEvents.map(networkEventToFeedEvent);
        for (const e of mapped) seenIdsRef.current.add(e.id);
        setLiveEvents(mapped);
      })
      .catch(() => {
        setLiveEvents([]);
      });

    api.users.me().then((u) => {
      if (!cancelled && u.avatar_url) setUserAvatarUrl(u.avatar_url);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleGitPushed = (event: EngineEvent) => {
      if (event.type !== "git_pushed") return;
      const feedEvent: FeedEvent = {
        id: `git-push-${event.spec_id ?? Date.now()}`,
        author: { name: "Agent", type: "agent" },
        repo: event.repo ?? "",
        branch: event.branch ?? "main",
        commits: (event.commits ?? []).map((c) => ({ sha: c.sha, message: c.message })),
        timestamp: new Date().toISOString(),
        summary: event.summary,
      };
      if (seenIdsRef.current.has(feedEvent.id)) return;
      seenIdsRef.current.add(feedEvent.id);
      setLiveEvents((prev) => [feedEvent, ...(prev ?? [])]);
    };

    const handleNetworkEvent = (event: EngineEvent) => {
      if (event.type !== "network_event") return;
      const payload = event.payload;
      if (!payload) return;
      const wsType = (payload.type as string) ?? "";
      if (wsType !== "activity.new") return;
      const data = payload.data as NetworkFeedEvent | undefined;
      if (!data || !data.id) return;
      if (seenIdsRef.current.has(data.id)) return;
      seenIdsRef.current.add(data.id);
      const feedEvent = networkEventToFeedEvent(data);
      setLiveEvents((prev) => [feedEvent, ...(prev ?? [])]);
    };

    const unsub1 = subscribe("git_pushed", handleGitPushed);
    const unsub2 = subscribe("network_event", handleNetworkEvent);
    return () => { unsub1(); unsub2(); };
  }, [subscribe]);

  const followedNames = useMemo(
    () => new Set(follows.map((f) => f.target_profile_id)),
    [follows],
  );

  const currentUserAvatar = userAvatarUrl || (user?.profile_image && user.profile_image.startsWith("http") ? user.profile_image : undefined);
  const currentUserName = user?.display_name;

  const events = useMemo(
    () => {
      const source = liveEvents ?? [];
      return [...source].map((evt) => {
        if (currentUserAvatar && evt.author.type === "user" && evt.author.name === CURRENT_USER) {
          return { ...evt, author: { ...evt.author, name: currentUserName || evt.author.name, avatarUrl: currentUserAvatar } };
        }
        return evt;
      }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },
    [liveEvents, currentUserAvatar, currentUserName],
  );

  const filteredEvents = useMemo(
    () => applyFilter(events, filter, followedNames),
    [events, filter, followedNames],
  );

  const commitActivity = useMemo(
    () => commitActivityFromEvents(filteredEvents),
    [filteredEvents],
  );

  const selectEvent = useCallback((id: string | null) => {
    setSelectedEventId(id);
    if (id) setSelectedProfile(null);
  }, []);

  const selectProfile = useCallback((profile: FeedSelectedProfile | null) => {
    setSelectedProfile(profile);
    if (profile) setSelectedEventId(null);
  }, []);

  const setFilter = useCallback((f: FeedFilter) => setFilterRaw(f), []);

  const getCommentsForEvent = useCallback(
    (eventId: string) =>
      comments
        .filter((c) => c.eventId === eventId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [comments],
  );

  const addComment = useCallback((eventId: string, text: string) => {
    const authorName = currentUserName || CURRENT_USER;
    const makeLocal = (): FeedComment => ({
      id: `cmt-${nextCommentId++}`,
      eventId,
      author: { name: authorName, type: "user", avatarUrl: currentUserAvatar },
      text,
      timestamp: new Date().toISOString(),
    });

    api.feed
      .addComment(eventId, text)
      .then((net) => {
        setComments((prev) => [...prev, networkCommentToFeedComment(net)]);
      })
      .catch(() => {
        setComments((prev) => [...prev, makeLocal()]);
      });
  }, [currentUserName, currentUserAvatar]);

  const value = useMemo(
    () => ({ events, filteredEvents, commitActivity, filter, setFilter, selectedEventId, selectEvent, selectedProfile, selectProfile, getCommentsForEvent, addComment }),
    [events, filteredEvents, commitActivity, filter, setFilter, selectedEventId, selectEvent, selectedProfile, selectProfile, getCommentsForEvent, addComment],
  );

  return <FeedCtx.Provider value={value}>{children}</FeedCtx.Provider>;
}

export function useFeed() {
  const ctx = useContext(FeedCtx);
  if (!ctx) throw new Error("useFeed must be used within FeedProvider");
  return ctx;
}
