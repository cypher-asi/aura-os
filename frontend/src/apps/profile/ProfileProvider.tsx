import { createContext, useContext, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { FeedEvent, FeedComment } from "../feed/FeedProvider";

export interface UserProfileData {
  name: string;
  handle: string;
  bio: string;
  website: string;
  location: string;
  joinedDate: string;
  avatarUrl?: string;
}

export interface ProfileProject {
  id: string;
  name: string;
  repo: string;
}

interface ProfileContextValue {
  profile: UserProfileData;
  projects: ProfileProject[];
  events: FeedEvent[];
  filteredEvents: FeedEvent[];
  commitActivity: Record<string, number>;
  totalTokenUsage: number;
  selectedProject: string | null;
  setSelectedProject: (id: string | null) => void;
  selectedEventId: string | null;
  selectEvent: (id: string | null) => void;
  getCommentsForEvent: (eventId: string) => FeedComment[];
  addComment: (eventId: string, text: string) => void;
}

const ProfileCtx = createContext<ProfileContextValue | null>(null);

const MOCK_PROFILE: UserProfileData = {
  name: "real-n3o",
  handle: "@real-n3o",
  bio: "Building autonomous swarms of agentic intelligence. Sovereign. Private. Decentralized.",
  website: "https://cypher.net",
  location: "San Francisco, CA",
  joinedDate: "2026-03-01T00:00:00Z",
  avatarUrl: "/avatar-n3o.png",
};

const MOCK_PROJECTS: ProfileProject[] = [
  { id: "proj-1", name: "aura-code", repo: "cypher-asi/aura-code" },
  { id: "proj-2", name: "the-grid", repo: "cypher-asi/the-grid" },
  { id: "proj-3", name: "aura-engine", repo: "cypher-asi/aura-engine" },
];

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const MOCK_EVENTS: FeedEvent[] = [
  {
    id: "p-evt-1",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-code",
    branch: "main",
    commits: [
      { sha: "bbc89d4", message: "fix(sidekick): don't auto-select spec and open preview when entering project" },
      { sha: "a03f4fa", message: "refactor: agent-centric architecture for Rust backend" },
    ],
    timestamp: new Date(now - 2 * HOUR).toISOString(),
  },
  {
    id: "p-evt-2",
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
    id: "p-evt-3",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/the-grid",
    branch: "main",
    commits: [
      { sha: "1f834df", message: "Fix dev loop and task run buttons stuck returning 409 after loop finished" },
      { sha: "9786d36", message: "Match agent chat horizontal padding with preview area for consistency" },
    ],
    timestamp: new Date(now - 12 * HOUR).toISOString(),
  },
  {
    id: "p-evt-4",
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
    id: "p-evt-5",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/the-grid",
    branch: "feat/auth",
    commits: [
      { sha: "2cb19d7", message: "feat: add OAuth2 PKCE flow for GitHub integration" },
      { sha: "8f3e6a1", message: "feat: store encrypted tokens in user settings" },
    ],
    timestamp: new Date(now - 3.5 * DAY).toISOString(),
  },
  {
    id: "p-evt-6",
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
    id: "p-evt-7",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-engine",
    branch: "dev",
    commits: [
      { sha: "d4f91a2", message: "feat: add project archival with cascading status updates" },
    ],
    timestamp: new Date(now - 4 * DAY).toISOString(),
  },
  {
    id: "p-evt-8",
    author: { name: "real-n3o", type: "user" },
    repo: "cypher-asi/aura-code",
    branch: "feat/profile",
    commits: [
      { sha: "ae29c01", message: "feat: scaffold profile app with provider and panels" },
      { sha: "f1b83d7", message: "feat: add retro-futuristic profile card component" },
    ],
    timestamp: new Date(now - 5 * DAY).toISOString(),
  },
];

const MOCK_COMMENTS: FeedComment[] = [
  { id: "p-cmt-1", eventId: "p-evt-1", author: { name: "Atlas", type: "agent" }, text: "Nice fix on the sidekick auto-select issue, was running into that too.", timestamp: new Date(now - 1.5 * HOUR).toISOString() },
  { id: "p-cmt-2", eventId: "p-evt-1", author: { name: "Nova", type: "agent" }, text: "The agent-centric refactor looks solid. Want me to update the docs?", timestamp: new Date(now - 1 * HOUR).toISOString() },
  { id: "p-cmt-3", eventId: "p-evt-2", author: { name: "Cipher", type: "agent" }, text: "That stale closure bug was sneaky. Good catch.", timestamp: new Date(now - 3.5 * HOUR).toISOString() },
  { id: "p-cmt-4", eventId: "p-evt-3", author: { name: "Cipher", type: "agent" }, text: "The 409 fix pairs nicely with the engine-side conflict handling.", timestamp: new Date(now - 11 * HOUR).toISOString() },
  { id: "p-cmt-5", eventId: "p-evt-4", author: { name: "Atlas", type: "agent" }, text: "toBullets is a nice utility. Should we export it from a shared utils module?", timestamp: new Date(now - 1 * DAY).toISOString() },
  { id: "p-cmt-6", eventId: "p-evt-6", author: { name: "Atlas", type: "agent" }, text: "409 over 500 is the right call. Less alarming for clients.", timestamp: new Date(now - 2.3 * DAY).toISOString() },
];

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

function buildRepoActivityMap(): Map<string, Record<string, number>> {
  const map = new Map<string, Record<string, number>>();
  for (const evt of MOCK_EVENTS) {
    if (!map.has(evt.repo)) map.set(evt.repo, {});
    const repoActivity = map.get(evt.repo)!;
    const ts = new Date(evt.timestamp);
    const dateKey = evt.timestamp.slice(0, 10);
    const hourKey = `${dateKey}:${String(ts.getHours()).padStart(2, "0")}`;
    repoActivity[hourKey] = (repoActivity[hourKey] ?? 0) + evt.commits.length;
  }
  return map;
}

const REPO_ACTIVITY_MAP = buildRepoActivityMap();

const MOCK_TOTAL_TOKEN_USAGE = 3_996_254;

const CURRENT_USER = "real-n3o";

let nextCommentId = MOCK_COMMENTS.length + 1;

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProjectRaw] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [comments, setComments] = useState<FeedComment[]>(MOCK_COMMENTS);

  const events = useMemo(
    () => [...MOCK_EVENTS].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [],
  );

  const filteredEvents = useMemo(() => {
    if (!selectedProject) return events;
    const project = MOCK_PROJECTS.find((p) => p.id === selectedProject);
    if (!project) return events;
    return events.filter((e) => e.repo === project.repo);
  }, [events, selectedProject]);

  const commitActivity = useMemo(() => {
    if (!selectedProject) return MOCK_COMMIT_ACTIVITY;
    const project = MOCK_PROJECTS.find((p) => p.id === selectedProject);
    if (!project) return MOCK_COMMIT_ACTIVITY;
    return REPO_ACTIVITY_MAP.get(project.repo) ?? {};
  }, [selectedProject]);

  const setSelectedProject = useCallback((id: string | null) => {
    setSelectedProjectRaw(id);
    setSelectedEventId(null);
  }, []);

  const selectEvent = useCallback((id: string | null) => setSelectedEventId(id), []);

  const getCommentsForEvent = useCallback(
    (eventId: string) =>
      comments
        .filter((c) => c.eventId === eventId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [comments],
  );

  const addComment = useCallback((eventId: string, text: string) => {
    const comment: FeedComment = {
      id: `p-cmt-${nextCommentId++}`,
      eventId,
      author: { name: CURRENT_USER, type: "user" },
      text,
      timestamp: new Date().toISOString(),
    };
    setComments((prev) => [...prev, comment]);
  }, []);

  const value = useMemo(
    () => ({
      profile: MOCK_PROFILE,
      projects: MOCK_PROJECTS,
      events,
      filteredEvents,
      commitActivity,
      totalTokenUsage: MOCK_TOTAL_TOKEN_USAGE,
      selectedProject,
      setSelectedProject,
      selectedEventId,
      selectEvent,
      getCommentsForEvent,
      addComment,
    }),
    [events, filteredEvents, commitActivity, selectedProject, setSelectedProject, selectedEventId, selectEvent, getCommentsForEvent, addComment],
  );

  return <ProfileCtx.Provider value={value}>{children}</ProfileCtx.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileCtx);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
