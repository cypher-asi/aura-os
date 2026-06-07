/*
 * Hardcoded data for `MockAuraDesktop` — the interactive, app-faithful
 * mock of the authenticated AURA desktop shell rendered on the `/code`
 * marketing page. None of this is live: it stands in for the agent
 * library, the LLM chat transcripts, the project explorer, and the
 * sidekick terminal/task surfaces a real logged-in workspace would
 * show, so the mock reads as a believable snapshot of the app without
 * touching any store, socket, or API.
 */

import { AGENTS, type AgentId } from "../../public-chat/agent-demo-script";

/* ---------------------------------------------------------------- */
/* Center LLM chat                                                   */
/* ---------------------------------------------------------------- */

export type MockChatSpeaker = "user" | "agent";

/** A streamed text bubble. `typingMs`, when set, plays the typing
 *  indicator for that many ms before the text reveals. */
export interface MockChatMessage {
  readonly from: MockChatSpeaker;
  readonly kind: "message";
  readonly text: string;
  readonly typingMs?: number;
}

/** A tool card — always the agent's side. Reuses the `TerminalStream`
 *  preview shape (lines + optional hljs language). */
export interface MockChatTool {
  readonly from: "agent";
  readonly kind: "tool";
  readonly toolName: string;
  readonly target?: string;
  readonly preview: readonly string[];
  readonly language?: string;
  readonly typingMs?: number;
}

export type MockChatFrame = MockChatMessage | MockChatTool;

export interface MockAgent {
  readonly id: AgentId;
  readonly name: string;
  readonly role: string;
  /** Pre-resolved avatar dot status (e.g. "running", "idle"). */
  readonly status: string;
  /** Whether the agent renders the "busy" rotating ring. */
  readonly busy: boolean;
  /** Accent color (from the shared AURA agent palette). */
  readonly accent: string;
  /** One-line preview shown under the agent name in the sidebar row. */
  readonly preview: string;
  /** Scripted conversation the center chat replays when selected. */
  readonly transcript: readonly MockChatFrame[];
}

/**
 * The standalone agent library shown in the left nav's "Agents" pane.
 * Seeded from the shared `AGENTS` palette so the colors/names match the
 * landing-hero demo, then given a role, a recent-message preview, and a
 * short scripted transcript for the center chat.
 */
export const MOCK_AGENTS: readonly MockAgent[] = [
  {
    id: "frontend",
    name: AGENTS.frontend.name,
    role: "UI Engineer",
    status: "running",
    busy: true,
    accent: AGENTS.frontend.color,
    preview: "Shipped the dashboard layout — running tests now.",
    transcript: [
      { from: "user", kind: "message", text: "Build the dashboard layout from the spec." },
      {
        from: "agent",
        kind: "message",
        typingMs: 900,
        text: "On it. Scaffolding the grid and wiring the panels now.",
      },
      {
        from: "agent",
        kind: "tool",
        toolName: "edit",
        target: "src/components/Dashboard.tsx",
        language: "typescript",
        preview: [
          "export function Dashboard() {",
          "  return (",
          "    <Grid cols={12} gap={16}>",
          "      <StatCards />",
          "      <ActivityFeed />",
          "    </Grid>",
          "  );",
          "}",
        ],
      },
      {
        from: "agent",
        kind: "message",
        typingMs: 700,
        text: "Layout's in. 42/42 tests passing and the build is verified.",
      },
    ],
  },
  {
    id: "backend",
    name: AGENTS.backend.name,
    role: "API & Data",
    status: "idle",
    busy: false,
    accent: AGENTS.backend.color,
    preview: "Added the billing webhook handler with retries.",
    transcript: [
      { from: "user", kind: "message", text: "Wire up the Stripe billing webhooks." },
      {
        from: "agent",
        kind: "message",
        typingMs: 800,
        text: "Adding the handler with signature verification and retry backoff.",
      },
      {
        from: "agent",
        kind: "tool",
        toolName: "run",
        target: "pytest tests/billing",
        language: "bash",
        preview: [
          "$ pytest tests/billing -q",
          "collected 18 items",
          "................. 18 passed in 1.92s",
        ],
      },
      {
        from: "agent",
        kind: "message",
        typingMs: 600,
        text: "Webhooks are live and idempotent. Replays are safe now.",
      },
    ],
  },
  {
    id: "architect",
    name: AGENTS.architect.name,
    role: "Systems Design",
    status: "idle",
    busy: false,
    accent: AGENTS.architect.color,
    preview: "Drafted the migration plan for the auth service.",
    transcript: [
      { from: "user", kind: "message", text: "How should we split the monolith's auth out?" },
      {
        from: "agent",
        kind: "message",
        typingMs: 1000,
        text: "Carve auth into its own service behind a token gateway, migrate in three phases.",
      },
      {
        from: "agent",
        kind: "tool",
        toolName: "write",
        target: "docs/auth-migration.md",
        language: "markdown",
        preview: [
          "# Auth migration",
          "1. Extract token issuance",
          "2. Shadow-read sessions",
          "3. Cut traffic over",
        ],
      },
    ],
  },
  {
    id: "reviewer",
    name: AGENTS.reviewer.name,
    role: "Code Review",
    status: "idle",
    busy: false,
    accent: AGENTS.reviewer.color,
    preview: "Approved PR #214 with two small nits.",
    transcript: [
      { from: "user", kind: "message", text: "Review the dashboard PR before we merge." },
      {
        from: "agent",
        kind: "message",
        typingMs: 850,
        text: "Looks solid. Two nits: memoize the feed selector and tighten the Grid prop types.",
      },
      {
        from: "agent",
        kind: "message",
        typingMs: 500,
        text: "Otherwise approved — safe to merge once those land.",
      },
    ],
  },
];

/* ---------------------------------------------------------------- */
/* Left nav — Projects pane                                          */
/* ---------------------------------------------------------------- */

export interface MockProject {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly active?: boolean;
}

export const MOCK_PROJECTS: readonly MockProject[] = [
  { id: "aura-os", name: "aura-os", subtitle: "3 agents · main", active: true },
  { id: "billing", name: "billing-service", subtitle: "1 agent · deploy" },
  { id: "marketing", name: "marketing-site", subtitle: "2 agents · staging" },
];

export interface MockTreeRow {
  readonly label: string;
  readonly depth: number;
  readonly kind: "folder-open" | "folder" | "file";
  readonly active?: boolean;
}

export const EXPLORER_ROWS: readonly MockTreeRow[] = [
  { label: "aura-os", depth: 0, kind: "folder-open" },
  { label: "interface", depth: 1, kind: "folder-open" },
  { label: "src", depth: 2, kind: "folder-open" },
  { label: "components", depth: 3, kind: "folder" },
  { label: "Dashboard.tsx", depth: 3, kind: "file", active: true },
  { label: "main.tsx", depth: 3, kind: "file" },
  { label: "server", depth: 1, kind: "folder" },
  { label: "package.json", depth: 1, kind: "file" },
];

/* ---------------------------------------------------------------- */
/* Right sidekick — scripted Terminal -> Tasks sequence             */
/* ---------------------------------------------------------------- */

export const TERMINAL_LINES: readonly string[] = [
  "$ aura run --loop",
  "› planning next task from spec",
  "› editing src/components/Dashboard.tsx",
  "› running test suite",
  "✓ 42 passing · build verified",
  "› committing changes",
];

export type MockTaskStatus = "done" | "in_progress" | "ready" | "blocked";

export interface MockTaskRow {
  readonly title: string;
  readonly status: MockTaskStatus;
  readonly child?: boolean;
}

export const TASK_ROWS: readonly MockTaskRow[] = [
  { title: "Scaffold project structure", status: "done" },
  { title: "Wire up authentication flow", status: "done" },
  { title: "Build the dashboard layout", status: "in_progress" },
  { title: "Add settings panel", status: "in_progress", child: true },
  { title: "Integrate billing webhooks", status: "ready" },
  { title: "Write end-to-end tests", status: "ready" },
  { title: "Resolve flaky CI run", status: "blocked" },
];
