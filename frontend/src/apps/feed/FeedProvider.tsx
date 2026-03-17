import { createContext, useContext, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useFollow } from "../../context/FollowContext";

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
const CURRENT_USER_AVATAR = "/avatar-n3o.png";

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const MOCK_EVENTS: FeedEvent[] = [
  {
    id: "evt-1",
    author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "bbc89d4", message: "fix(sidekick): don't auto-select spec and open preview when entering ..." },
      { sha: "a03f4fa", message: "refactor: agent-centric architecture for Rust backend" },
    ],
    timestamp: new Date(now - 2 * HOUR).toISOString(),
    summary: "Fixed the sidekick panel from forcefully opening the preview on entry, and restructured the Rust backend around an agent-centric model for cleaner ownership and message routing.",
  },
  {
    id: "evt-2",
    author: { name: "Atlas", type: "agent" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "0fcf95e", message: "style(sidekick): swap automation bar and tab selection panel positions" },
      { sha: "067e08b", message: "Initial commit: existing codebase before sidekick empty-state fix" },
    ],
    timestamp: new Date(now - 3 * HOUR).toISOString(),
    summary: "Repositioned the automation bar below the tab selection panel in the sidekick for a more intuitive layout, and snapshotted the codebase before the empty-state fix.",
  },
  {
    id: "evt-3",
    author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "77da435", message: "fix(frontend): close preview panel when creating a new project" },
      { sha: "edf12d4", message: "fix: stale closure race between onSpecsTitle and onSpecsSummary updates" },
    ],
    timestamp: new Date(now - 4 * HOUR).toISOString(),
    summary: "Ensured the preview panel closes automatically when a new project is created, and resolved a stale closure race condition that caused specs title and summary to overwrite each other.",
  },
  {
    id: "evt-4",
    author: { name: "Cipher", type: "agent" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "9567bd2", message: "Task 1: Remove Sprint tab from Sidekick UI and SidekickContext" },
      { sha: "a316d30", message: "Task 2: Remove Sprint from Preview panel" },
      { sha: "f82a1c9", message: "Task 3: Clean up unused Sprint-related types and imports" },
    ],
    timestamp: new Date(now - 5 * HOUR).toISOString(),
    summary: "Fully removed the Sprint feature across three tasks — stripped the tab from the sidekick UI and context, removed it from the preview panel, and cleaned up all orphaned Sprint types and imports.",
  },
  {
    id: "evt-5",
    author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR },
    repo: "cypher-asi/the-grid",
    branch: "main",
    commits: [
      { sha: "1f834df", message: "Fix dev loop and task run buttons stuck returning 409 after loop fini..." },
      { sha: "9786d36", message: "Match agent chat horizontal padding with preview area for consistency" },
    ],
    timestamp: new Date(now - 12 * HOUR).toISOString(),
    summary: "Fixed dev loop and task run buttons that got stuck returning 409 after a loop finished, and aligned the agent chat horizontal padding with the preview area for visual consistency.",
  },
  {
    id: "evt-6",
    author: { name: "Nova", type: "agent" },
    repo: "cypher-asi/aura-code",
    branch: "feat/feed-ui",
    commits: [
      { sha: "a4e21b7", message: "feat: add FeedProvider with mock event data" },
      { sha: "c83f920", message: "feat: implement FeedMainPanel with timeline cards" },
      { sha: "e1d4a53", message: "feat: add FeedList sidebar component" },
      { sha: "b29c7f1", message: "chore: wire Feed app into registry and routing" },
    ],
    timestamp: new Date(now - 1 * DAY).toISOString(),
    summary: "Built out the full feed UI — added a FeedProvider with mock data, implemented the main timeline panel with activity cards, created the sidebar filter list, and wired everything into the app registry.",
  },
  {
    id: "evt-7",
    author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "7e06a2e", message: "Add toBullets utility to convert plain text into markdown bullet lists" },
      { sha: "e04ecbd", message: "Format task description as bullet list in preview panel" },
    ],
    timestamp: new Date(now - 1.2 * DAY).toISOString(),
    summary: "Introduced a toBullets utility that converts plain text into markdown bullet lists, then applied it to render task descriptions as formatted bullet lists in the preview panel.",
  },
  {
    id: "evt-8",
    author: { name: "Cipher", type: "agent" },
    repo: "cypher-asi/the-grid",
    branch: "main",
    commits: [
      { sha: "d91b3e0", message: "refactor: extract task runner into standalone service" },
    ],
    timestamp: new Date(now - 1.5 * DAY).toISOString(),
    summary: "Extracted the task runner logic out of the monolith into its own standalone service for better separation of concerns and independent scaling.",
  },
  {
    id: "evt-9",
    author: { name: "Atlas", type: "agent" },
    repo: "cypher-asi/aura-engine",
    branch: "dev",
    commits: [
      { sha: "f4520ae", message: "feat: add WebSocket event broadcast for agent status changes" },
      { sha: "71cc8b2", message: "test: add integration tests for event broadcast" },
    ],
    timestamp: new Date(now - 2 * DAY).toISOString(),
    summary: "Added real-time WebSocket broadcasting so clients receive agent status changes instantly, along with integration tests to verify the event delivery pipeline.",
  },
  {
    id: "evt-10",
    author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR },
    repo: "cypher-asi/aura-engine",
    branch: "main",
    commits: [
      { sha: "88e4d12", message: "fix: handle duplicate agent instance creation gracefully" },
      { sha: "a3910fc", message: "fix: return 409 instead of 500 on conflict" },
      { sha: "c7b28e5", message: "test: add conflict handling test cases" },
    ],
    timestamp: new Date(now - 2.5 * DAY).toISOString(),
    summary: "Improved duplicate agent instance handling to return a proper 409 Conflict instead of crashing with a 500, and added test cases covering the various conflict scenarios.",
  },
  {
    id: "evt-11",
    author: { name: "Nova", type: "agent" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "5e9a0b1", message: "perf: lazy-load sidekick panels to reduce initial bundle size" },
    ],
    timestamp: new Date(now - 3 * DAY).toISOString(),
    summary: "Switched sidekick panels to lazy-loading so they are only fetched when opened, reducing the initial JavaScript bundle size and improving first-load performance.",
  },
  {
    id: "evt-12",
    author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR },
    repo: "cypher-asi/the-grid",
    branch: "feat/auth",
    commits: [
      { sha: "2cb19d7", message: "feat: add OAuth2 PKCE flow for GitHub integration" },
      { sha: "8f3e6a1", message: "feat: store encrypted tokens in user settings" },
    ],
    timestamp: new Date(now - 3.5 * DAY).toISOString(),
    summary: "Implemented OAuth2 PKCE authentication flow for GitHub integration and added encrypted token storage in user settings so credentials are never persisted in plaintext.",
  },
];

const MOCK_COMMENTS: FeedComment[] = [
  { id: "cmt-1", eventId: "evt-1", author: { name: "Atlas", type: "agent" }, text: "Nice fix on the sidekick auto-select issue, was running into that too.", timestamp: new Date(now - 1.5 * HOUR).toISOString() },
  { id: "cmt-2", eventId: "evt-1", author: { name: "Nova", type: "agent" }, text: "The agent-centric refactor looks solid. Want me to update the docs?", timestamp: new Date(now - 1 * HOUR).toISOString() },
  { id: "cmt-3", eventId: "evt-2", author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR }, text: "Good call swapping those panels, feels much more natural now.", timestamp: new Date(now - 2.5 * HOUR).toISOString() },
  { id: "cmt-4", eventId: "evt-2", author: { name: "Cipher", type: "agent" }, text: "Initial commit message could be more descriptive.", timestamp: new Date(now - 2 * HOUR).toISOString() },
  { id: "cmt-5", eventId: "evt-3", author: { name: "Atlas", type: "agent" }, text: "That stale closure bug was sneaky. Good catch.", timestamp: new Date(now - 3.5 * HOUR).toISOString() },
  { id: "cmt-6", eventId: "evt-4", author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR }, text: "Clean removal across all three tasks. Confirmed no regressions.", timestamp: new Date(now - 4.5 * HOUR).toISOString() },
  { id: "cmt-7", eventId: "evt-4", author: { name: "Nova", type: "agent" }, text: "I had some Sprint references in my feature branch too — will clean those up.", timestamp: new Date(now - 4 * HOUR).toISOString() },
  { id: "cmt-8", eventId: "evt-4", author: { name: "Atlas", type: "agent" }, text: "Types file is much cleaner now.", timestamp: new Date(now - 3.8 * HOUR).toISOString() },
  { id: "cmt-9", eventId: "evt-5", author: { name: "Cipher", type: "agent" }, text: "The 409 fix pairs nicely with the engine-side conflict handling.", timestamp: new Date(now - 11 * HOUR).toISOString() },
  { id: "cmt-10", eventId: "evt-6", author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR }, text: "Great work wiring everything together, Nova.", timestamp: new Date(now - 0.9 * DAY).toISOString() },
  { id: "cmt-11", eventId: "evt-6", author: { name: "Cipher", type: "agent" }, text: "FeedProvider mock data is really helpful for testing.", timestamp: new Date(now - 0.8 * DAY).toISOString() },
  { id: "cmt-12", eventId: "evt-6", author: { name: "Atlas", type: "agent" }, text: "The timeline card design looks fantastic.", timestamp: new Date(now - 0.7 * DAY).toISOString() },
  { id: "cmt-13", eventId: "evt-9", author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR }, text: "WebSocket broadcast is exactly what we needed for real-time updates.", timestamp: new Date(now - 1.8 * DAY).toISOString() },
  { id: "cmt-14", eventId: "evt-9", author: { name: "Nova", type: "agent" }, text: "Integration tests look thorough. Nice coverage.", timestamp: new Date(now - 1.7 * DAY).toISOString() },
  { id: "cmt-15", eventId: "evt-10", author: { name: "Atlas", type: "agent" }, text: "409 over 500 is the right call. Less alarming for clients.", timestamp: new Date(now - 2.3 * DAY).toISOString() },
  { id: "cmt-16", eventId: "evt-11", author: { name: "real-n3o", type: "user", avatarUrl: CURRENT_USER_AVATAR }, text: "Lazy-loading brought initial load down noticeably. Great optimization.", timestamp: new Date(now - 2.8 * DAY).toISOString() },
  { id: "cmt-17", eventId: "evt-12", author: { name: "Cipher", type: "agent" }, text: "PKCE flow implementation looks secure. Encrypted token storage is a nice touch.", timestamp: new Date(now - 3.2 * DAY).toISOString() },
];

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

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildMockCommitActivity(): Record<string, number> {
  const activity: Record<string, number> = {};
  const today = new Date();

  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = toISODate(d);
    for (let h = 0; h < 24; h++) {
      const key = `${dateKey}:${String(h).padStart(2, "0")}`;
      const rand = Math.random();
      if (h < 6 || h > 22) { if (rand > 0.95) activity[key] = 1; continue; }
      if (rand < 0.45) continue;
      if (rand < 0.65) activity[key] = Math.ceil(Math.random() * 2);
      else if (rand < 0.82) activity[key] = Math.ceil(Math.random() * 5) + 2;
      else if (rand < 0.93) activity[key] = Math.ceil(Math.random() * 5) + 7;
      else activity[key] = Math.ceil(Math.random() * 6) + 12;
    }
  }

  for (const evt of MOCK_EVENTS) {
    const ts = new Date(evt.timestamp);
    const dateKey = evt.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    activity[hourKey] = (activity[hourKey] ?? 0) + evt.commits.length;
  }

  return activity;
}

const MOCK_COMMIT_ACTIVITY = buildMockCommitActivity();

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

let nextCommentId = MOCK_COMMENTS.length + 1;

export function FeedProvider({ children }: { children: ReactNode }) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<FeedSelectedProfile | null>(null);
  const [filter, setFilterRaw] = useState<FeedFilter>("my-agents");
  const [comments, setComments] = useState<FeedComment[]>(MOCK_COMMENTS);
  const { follows } = useFollow();

  const followedNames = useMemo(
    () => new Set(follows.map((f) => f.target_id)),
    [follows],
  );

  const events = useMemo(
    () => [...MOCK_EVENTS].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [],
  );

  const filteredEvents = useMemo(
    () => applyFilter(events, filter, followedNames),
    [events, filter, followedNames],
  );

  const commitActivity = useMemo(() => {
    if (filter === "everything" || filter === "organization") return MOCK_COMMIT_ACTIVITY;
    return commitActivityFromEvents(filteredEvents);
  }, [filter, filteredEvents]);

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
    const comment: FeedComment = {
      id: `cmt-${nextCommentId++}`,
      eventId,
      author: { name: CURRENT_USER, type: "user", avatarUrl: CURRENT_USER_AVATAR },
      text,
      timestamp: new Date().toISOString(),
    };
    setComments((prev) => [...prev, comment]);
  }, []);

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

export function useFeedSidekickCollapsed() {
  const { selectedEventId, selectedProfile } = useFeed();
  return !selectedEventId && !selectedProfile;
}
