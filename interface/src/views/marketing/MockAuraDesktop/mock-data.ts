/*
 * Hardcoded data for `MockAuraDesktop` — the static, decorative mock of
 * the authenticated AURA desktop shell rendered on the `/code` marketing
 * page. None of this is live: it stands in for the project explorer,
 * task feed, and log stream a real logged-in workspace would show so the
 * mock reads as a believable snapshot of the app without touching any
 * store, socket, or API.
 */

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
  { label: "App.tsx", depth: 3, kind: "file", active: true },
  { label: "main.tsx", depth: 3, kind: "file" },
  { label: "server", depth: 1, kind: "folder" },
  { label: "package.json", depth: 1, kind: "file" },
  { label: "README.md", depth: 1, kind: "file" },
];

export type MockTaskStatus =
  | "done"
  | "in_progress"
  | "ready"
  | "blocked";

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

export type MockLogCategory =
  | "loop"
  | "task"
  | "output"
  | "files"
  | "session"
  | "spec";

export interface MockLogRow {
  readonly timestamp: string;
  readonly category: MockLogCategory;
  readonly label: string;
  readonly summary: string;
}

export const LOG_ROWS: readonly MockLogRow[] = [
  { timestamp: "00:41:02", category: "session", label: "Session", summary: "Session #18 started · model claude-sonnet" },
  { timestamp: "00:41:09", category: "loop", label: "Loop", summary: "Planning next task from spec" },
  { timestamp: "00:41:55", category: "task", label: "Task", summary: "Building the dashboard layout" },
  { timestamp: "00:42:31", category: "files", label: "Files", summary: "Edited src/components/Dashboard.tsx (+86 -12)" },
  { timestamp: "00:43:04", category: "output", label: "Output", summary: "Tests passing (42/42) · build verified" },
  { timestamp: "00:43:40", category: "spec", label: "Spec", summary: "Marked acceptance criteria 3/5 complete" },
];

export interface MockAgentAvatar {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly status: string;
}

export const FAVORITE_AGENTS: readonly MockAgentAvatar[] = [
  { id: "builder", name: "Builder", status: "working" },
  { id: "reviewer", name: "Reviewer", status: "idle" },
  { id: "researcher", name: "Researcher", status: "idle" },
];
