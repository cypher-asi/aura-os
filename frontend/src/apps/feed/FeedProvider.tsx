import { createContext, useContext, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";

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
}

export type FeedFilter = "my-agents" | "organization" | "following" | "everything";

interface FeedContextValue {
  events: FeedEvent[];
  filteredEvents: FeedEvent[];
  filter: FeedFilter;
  setFilter: (filter: FeedFilter) => void;
  selectedEventId: string | null;
  selectEvent: (id: string | null) => void;
}

const FeedCtx = createContext<FeedContextValue | null>(null);

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const MOCK_EVENTS: FeedEvent[] = [
  {
    id: "evt-1",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "bbc89d4", message: "fix(sidekick): don't auto-select spec and open preview when entering ..." },
      { sha: "a03f4fa", message: "refactor: agent-centric architecture for Rust backend" },
    ],
    timestamp: new Date(now - 2 * HOUR).toISOString(),
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
  },
  {
    id: "evt-3",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "77da435", message: "fix(frontend): close preview panel when creating a new project" },
      { sha: "edf12d4", message: "fix: stale closure race between onSpecsTitle and onSpecsSummary updates" },
    ],
    timestamp: new Date(now - 4 * HOUR).toISOString(),
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
  },
  {
    id: "evt-5",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/the-grid",
    branch: "main",
    commits: [
      { sha: "1f834df", message: "Fix dev loop and task run buttons stuck returning 409 after loop fini..." },
      { sha: "9786d36", message: "Match agent chat horizontal padding with preview area for consistency" },
    ],
    timestamp: new Date(now - 12 * HOUR).toISOString(),
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
  },
  {
    id: "evt-7",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "7e06a2e", message: "Add toBullets utility to convert plain text into markdown bullet lists" },
      { sha: "e04ecbd", message: "Format task description as bullet list in preview panel" },
    ],
    timestamp: new Date(now - 1.2 * DAY).toISOString(),
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
  },
  {
    id: "evt-10",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-engine",
    branch: "main",
    commits: [
      { sha: "88e4d12", message: "fix: handle duplicate agent instance creation gracefully" },
      { sha: "a3910fc", message: "fix: return 409 instead of 500 on conflict" },
      { sha: "c7b28e5", message: "test: add conflict handling test cases" },
    ],
    timestamp: new Date(now - 2.5 * DAY).toISOString(),
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
  },
  {
    id: "evt-12",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/the-grid",
    branch: "feat/auth",
    commits: [
      { sha: "2cb19d7", message: "feat: add OAuth2 PKCE flow for GitHub integration" },
      { sha: "8f3e6a1", message: "feat: store encrypted tokens in user settings" },
    ],
    timestamp: new Date(now - 3.5 * DAY).toISOString(),
  },
];

const CURRENT_USER = "real-n3o";

function applyFilter(events: FeedEvent[], filter: FeedFilter): FeedEvent[] {
  switch (filter) {
    case "my-agents":
      return events.filter((e) => e.author.type === "agent");
    case "following":
      return events.filter((e) => e.author.name === CURRENT_USER);
    case "organization":
    case "everything":
    default:
      return events;
  }
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filter, setFilterRaw] = useState<FeedFilter>("everything");

  const events = useMemo(
    () => [...MOCK_EVENTS].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [],
  );

  const filteredEvents = useMemo(() => applyFilter(events, filter), [events, filter]);

  const selectEvent = useCallback((id: string | null) => setSelectedEventId(id), []);
  const setFilter = useCallback((f: FeedFilter) => setFilterRaw(f), []);

  const value = useMemo(
    () => ({ events, filteredEvents, filter, setFilter, selectedEventId, selectEvent }),
    [events, filteredEvents, filter, setFilter, selectedEventId, selectEvent],
  );

  return <FeedCtx.Provider value={value}>{children}</FeedCtx.Provider>;
}

export function useFeed() {
  const ctx = useContext(FeedCtx);
  if (!ctx) throw new Error("useFeed must be used within FeedProvider");
  return ctx;
}
