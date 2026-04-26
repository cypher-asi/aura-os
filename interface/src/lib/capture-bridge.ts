import { apps } from "../apps/registry";
import { LAST_APP_KEY, PREVIOUS_PATH_KEY } from "../constants";
import { AURA_MANAGED_CHAT_MODELS } from "../constants/models";
import type {
  Agent,
  AgentInstance,
  Process,
  ProcessEvent,
  ProcessNode,
  ProcessNodeConnection,
  ProcessRun,
  Project,
  Task,
} from "../shared/types";
import type { NotesTreeNode } from "../shared/api/notes";
import type { FeedbackComment, FeedbackItem } from "../apps/feedback/types";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { emptyAgentPermissions } from "../shared/types/permissions-wire";
import { sanitizeRestorePath } from "../utils/last-app-path";
import type { ProjectStatsData } from "../shared/api/projects";
import { writeCaptureDemoProjectStats } from "./capture-demo-stats";

const DESKTOP_WINDOWS_STORAGE_KEY = "aura:desktopWindows";
const DEMO_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const DEMO_AGENT_INSTANCE_ID = "capture-demo-agent-instance";
const DEMO_PROCESS_ID = "capture-demo-process";
const DEMO_PROCESS_RUN_ID = "capture-demo-process-run";
const DEMO_NOTE_PATH = "Launch Plan.md";

const appBasePathById = new Map(apps.map((app) => [app.id, app.basePath]));

export interface AuraCaptureSeedPlan {
  schemaVersion?: number;
  mode?: string | null;
  capabilities?: string[];
  requiredState?: string[];
  readinessSignals?: string[];
  proofBoundary?: string[];
  contextBoundary?: string[];
  avoid?: string[];
  notes?: string | null;
}

export interface AuraCaptureResetRequest {
  targetAppId?: string | null;
  targetPath?: string | null;
  seedPlan?: AuraCaptureSeedPlan | null;
  sidekickCollapsed?: boolean;
  timeoutMs?: number;
}

export interface AuraCaptureBridgeState {
  timestamp: string;
  currentPath: string;
  targetPath: string | null;
  targetAppId: string | null;
  routeMatched: boolean;
  activeAppId: string | null;
  activeAppLabel: string | null;
  activeAppMatched: boolean;
  launcherVisible: boolean;
  mainPanelVisible: boolean;
  shellVisible: boolean;
  sidekickVisible: boolean;
  placeholderVisible: boolean;
  feedbackComposerVisible: boolean;
  dialogVisible: boolean;
  sidekickInfoVisible: boolean;
  sidekickPreviewVisible: boolean;
  orgSettingsOpen: boolean;
  buyCreditsOpen: boolean;
  hostSettingsOpen: boolean;
  appsModalOpen: boolean;
  newProjectModalOpen: boolean;
  desktopWindowCount: number;
  seedProofVisible: boolean;
}

function normalizePathname(value: string | null | undefined): string | null {
  const sanitized = sanitizeRestorePath(value);
  if (!sanitized) {
    return null;
  }
  return sanitized.split(/[?#]/, 1)[0] ?? sanitized;
}

function matchesTargetPath(currentPath: string, targetPath: string | null): boolean {
  const expectedPathname = normalizePathname(targetPath);
  if (!expectedPathname) {
    return true;
  }

  const currentPathname = normalizePathname(currentPath);
  if (!currentPathname) {
    return false;
  }

  return currentPathname === expectedPathname
    || currentPathname.startsWith(`${expectedPathname}/`);
}

function isVisible(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0.05
    && rect.width > 0
    && rect.height > 0;
}

function hasVisibleDialogWithText(pattern: RegExp): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .some((node) => isVisible(node) && pattern.test(node.textContent || ""));
}

export function resolveAuraCaptureTargetAppId(request: AuraCaptureResetRequest = {}): string | null {
  if (request.targetAppId && appBasePathById.has(request.targetAppId)) {
    return request.targetAppId;
  }

  const targetPathname = normalizePathname(request.targetPath);
  if (!targetPathname) {
    return null;
  }

  const matched = apps.find((app) =>
    targetPathname === app.basePath || targetPathname.startsWith(`${app.basePath}/`),
  );
  return matched?.id ?? null;
}

export function resolveAuraCaptureTargetPath(request: AuraCaptureResetRequest = {}): string | null {
  const explicitPath = sanitizeRestorePath(request.targetPath);
  const targetAppId = resolveAuraCaptureTargetAppId(request);
  if (targetAppId === "projects" && (!explicitPath || explicitPath === "/projects")) {
    const text = seedText(request.seedPlan, targetAppId);
    if (/\b(?:project-stats-populated|stats?|metrics?|completion)\b/i.test(text)) {
      return `/projects/${DEMO_PROJECT_ID}/stats`;
    }
    return `/projects/${DEMO_PROJECT_ID}`;
  }

  if (explicitPath) {
    return explicitPath;
  }

  if (!targetAppId) {
    return null;
  }

  return appBasePathById.get(targetAppId) ?? null;
}

export function persistAuraCaptureTarget(targetPath: string | null, targetAppId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (targetPath) {
      window.localStorage.setItem(PREVIOUS_PATH_KEY, targetPath);
    } else {
      window.localStorage.removeItem(PREVIOUS_PATH_KEY);
    }

    if (targetAppId) {
      window.localStorage.setItem(LAST_APP_KEY, targetAppId);
    } else {
      window.localStorage.removeItem(LAST_APP_KEY);
    }
  } catch {
    // Ignore storage failures inside the screenshot bridge.
  }
}

export function clearAuraDesktopWindowPersistence(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(DESKTOP_WINDOWS_STORAGE_KEY);
  } catch {
    // Ignore storage failures inside the screenshot bridge.
  }
}

export function readAuraCaptureBridgeState(
  request: AuraCaptureResetRequest = {},
): AuraCaptureBridgeState {
  const targetPath = resolveAuraCaptureTargetPath(request);
  const targetAppId = resolveAuraCaptureTargetAppId({
    ...request,
    targetPath,
  });
  const currentPath =
    typeof window === "undefined"
      ? ""
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const mainPanel = document.querySelector('[data-agent-surface="main-panel"]');
  const activeAppId = mainPanel?.getAttribute("data-agent-active-app-id") || null;
  const activeAppLabel = mainPanel?.getAttribute("data-agent-active-app-label") || null;
  const launcherVisible = Array.from(document.querySelectorAll('[data-agent-role="app-launcher"]'))
    .some((node) => isVisible(node));
  const mainPanelVisible = isVisible(mainPanel);
  const sidekickVisible = isVisible(document.querySelector('[data-agent-surface="sidekick-panel"]'));
  const placeholderVisible = isVisible(document.querySelector('[data-agent-surface="shell-route-placeholder"]'));
  const feedbackComposerVisible = isVisible(document.querySelector('[data-agent-surface="feedback-composer"]'));
  const dialogVisible = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .some((node) => isVisible(node));
  const seedProofVisible = Array.from(document.querySelectorAll("[data-agent-proof]"))
    .some((node) => isVisible(node));

  return {
    timestamp: new Date().toISOString(),
    currentPath,
    targetPath,
    targetAppId,
    routeMatched: matchesTargetPath(currentPath, targetPath),
    activeAppId,
    activeAppLabel,
    activeAppMatched: targetAppId ? activeAppId === targetAppId : true,
    launcherVisible,
    mainPanelVisible,
    shellVisible: launcherVisible || mainPanelVisible,
    sidekickVisible,
    placeholderVisible,
    feedbackComposerVisible,
    dialogVisible,
    sidekickInfoVisible: Boolean(document.querySelector('[data-sidekick-info="true"]')),
    sidekickPreviewVisible: Boolean(document.querySelector('[data-sidekick-preview="true"]')),
    orgSettingsOpen: hasVisibleDialogWithText(/\bteam settings\b/i),
    buyCreditsOpen: hasVisibleDialogWithText(/\bbuy credits\b/i),
    hostSettingsOpen: hasVisibleDialogWithText(/\bhost connection\b/i),
    appsModalOpen: hasVisibleDialogWithText(/\bvisible in taskbar\b/i),
    newProjectModalOpen: hasVisibleDialogWithText(/\bnew project\b/i),
    desktopWindowCount: document.querySelectorAll('[data-window-layer-host="true"] [data-agent-id]').length,
    seedProofVisible,
  };
}

function seedText(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): string {
  return [
    targetAppId,
    ...(seedPlan?.capabilities ?? []),
    ...(seedPlan?.requiredState ?? []),
    ...(seedPlan?.readinessSignals ?? []),
    ...(seedPlan?.proofBoundary ?? []),
    ...(seedPlan?.contextBoundary ?? []),
    ...(seedPlan?.avoid ?? []),
    seedPlan?.notes,
  ].filter(Boolean).join("\n").toLowerCase();
}

function seedCapabilities(seedPlan: AuraCaptureSeedPlan | null | undefined): string[] {
  return Array.isArray(seedPlan?.capabilities)
    ? seedPlan.capabilities.map((entry) => entry.toLowerCase())
    : [];
}

export function shouldApplyAura3DSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:aura3d|aura3d|aura 3d|3d|generated image|asset gallery|model preview)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldOpenAura3DModelSurface(seedPlan: AuraCaptureSeedPlan | null | undefined): boolean {
  const capabilities = seedCapabilities(seedPlan);
  return capabilities.some((capability) => (
    capability === "model-source-image-populated"
    || capability === "model-preview-populated"
    || capability === "3d-model-ready"
    || capability === "source-image-ready-for-3d"
  ));
}

export function shouldApplyAgentChatSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:agents|agent chat|agents?|chat input|chat model|model picker|model menu|open-model-picker)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldApplyAgentActivitySeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return shouldApplyAgentChatSeed(seedPlan, targetAppId)
    && /\b(?:loop|progress|activity|active|running|run-history|harness|taskbar|shell|sidekick|sidebar|chrome)\b/i.test(seedText(seedPlan, targetAppId));
}

function normalizeModelSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function resolveSeedChatModel(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null) {
  const text = normalizeModelSearchText(seedText(seedPlan, targetAppId));
  const sortedModels = [...AURA_MANAGED_CHAT_MODELS].sort((a, b) => b.label.length - a.label.length);
  const requested = sortedModels.find((model) => {
    const label = normalizeModelSearchText(model.label);
    const id = normalizeModelSearchText(model.id);
    return (label && text.includes(label)) || (id && text.includes(id));
  });
  return requested ?? AURA_MANAGED_CHAT_MODELS[0];
}

function demoAgent(
  modelId: string,
  overrides: Partial<Pick<Agent, "agent_id" | "name" | "role" | "personality" | "skills" | "is_pinned">> = {},
): Agent {
  const now = new Date().toISOString();
  return {
    agent_id: overrides.agent_id ?? "capture-demo-agent",
    user_id: "capture-demo-user",
    org_id: "capture-demo-org",
    name: overrides.name ?? "Aura Guide",
    role: overrides.role ?? "Product walkthrough agent",
    personality: overrides.personality ?? "Clear, helpful, and product-focused.",
    system_prompt: "Help users explore Aura.",
    skills: overrides.skills ?? ["product-guidance", "workflow-planning"],
    icon: null,
    machine_type: "remote",
    adapter_type: "default",
    environment: "browser",
    auth_source: "capture-demo",
    integration_id: null,
    default_model: modelId,
    profile_id: "capture-demo-profile",
    tags: ["demo"],
    is_pinned: overrides.is_pinned ?? true,
    permissions: emptyAgentPermissions(),
    created_at: now,
    updated_at: now,
  };
}

function demoAgentMessages(): DisplaySessionEvent[] {
  return [
    {
      id: "capture-demo-user-message",
      role: "user",
      content: "Help me choose the best model for a product planning session.",
    },
    {
      id: "capture-demo-assistant-message",
      role: "assistant",
      content: "Open the model picker to choose the newest GPT or Claude option before starting.",
    },
    {
      id: "capture-demo-user-follow-up",
      role: "user",
      content: "Draft a concise launch checklist with the model choice, rollout owner, and QA gate.",
    },
    {
      id: "capture-demo-assistant-follow-up",
      role: "assistant",
      content: "Launch checklist ready: model picker verified, QA owner assigned, and release notes queued for review.",
    },
  ];
}

function demoSidebarAgents(modelId: string): Agent[] {
  return [
    demoAgent(modelId),
    demoAgent(modelId, {
      agent_id: "capture-demo-release-agent",
      name: "Release Scout",
      role: "Release analyst",
      personality: "Tracks changelog, release risk, and product polish.",
      skills: ["release-notes", "qa-review"],
      is_pinned: false,
    }),
    demoAgent(modelId, {
      agent_id: "capture-demo-design-agent",
      name: "Canvas Builder",
      role: "Design systems agent",
      personality: "Turns product flows into clean visual demos.",
      skills: ["ui-review", "storyboarding"],
      is_pinned: false,
    }),
  ];
}

function demoProject(): Project {
  const now = new Date().toISOString();
  return {
    project_id: DEMO_PROJECT_ID,
    org_id: "capture-demo-org",
    name: "Aura Launch Workspace",
    description: "Seeded capture workspace with realistic product proof data.",
    current_status: "active",
    specs_summary: "Changelog demo data is ready for visual proof capture.",
    specs_title: "Capture Demo",
    created_at: now,
    updated_at: now,
  };
}

function demoProjectStats(): ProjectStatsData {
  return {
    total_tasks: 18,
    pending_tasks: 3,
    ready_tasks: 5,
    in_progress_tasks: 2,
    blocked_tasks: 1,
    done_tasks: 7,
    failed_tasks: 0,
    completion_percentage: 62,
    total_tokens: 186_400,
    total_events: 128,
    total_agents: 4,
    total_sessions: 12,
    total_time_seconds: 14_820,
    lines_changed: 3_280,
    total_specs: 6,
    contributors: 5,
    estimated_cost_usd: 18.42,
  };
}

function demoProjectAgent(modelId = AURA_MANAGED_CHAT_MODELS[0]?.id ?? "default"): AgentInstance {
  const now = new Date().toISOString();
  return {
    agent_instance_id: DEMO_AGENT_INSTANCE_ID,
    project_id: DEMO_PROJECT_ID,
    agent_id: "capture-demo-project-agent",
    org_id: "capture-demo-org",
    name: "Release Pilot",
    role: "Launch execution agent",
    personality: "Practical, concise, and focused on visible product outcomes.",
    system_prompt: "Help ship Aura product updates safely.",
    skills: ["release-planning", "qa", "demo-data"],
    icon: null,
    machine_type: "remote",
    adapter_type: "default",
    environment: "browser",
    auth_source: "capture-demo",
    integration_id: null,
    default_model: modelId,
    workspace_path: "/workspace/aura-launch",
    status: "working",
    current_task_id: "capture-demo-task-2",
    current_session_id: "capture-demo-session",
    total_input_tokens: 18400,
    total_output_tokens: 4200,
    model: modelId,
    permissions: emptyAgentPermissions(),
    created_at: now,
    updated_at: now,
  };
}

async function seedDemoProject(): Promise<void> {
  const { useProjectsListStore } = await import("../stores/projects-list-store");
  const project = demoProject();
  const agent = demoProjectAgent();
  writeCaptureDemoProjectStats(project.project_id, demoProjectStats());
  useProjectsListStore.setState((state) => ({
    projects: [
      project,
      ...state.projects.filter((candidate) => candidate.project_id !== project.project_id),
    ],
    projectsOrgId: project.org_id,
    agentsByProject: {
      ...state.agentsByProject,
      [project.project_id]: [agent],
    },
    loadingAgentsByProject: {
      ...state.loadingAgentsByProject,
      [project.project_id]: false,
    },
    loadingProjects: false,
    projectsError: null,
  }));
}

function shouldApplyFeedbackSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:feedback|feedback|ideas?|votes?|comments?|board|thread|review status)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldApplyNotesSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:notes|notes?|documents?|editor|toc|table of contents|writing)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldApplyTasksSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:tasks|tasks?|kanban|board|lane|ready|in progress|done|blocked|automation)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldApplyProcessSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:process|processes?|workflow|nodes?|automation|graph|run history|run-history)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldApplyProjectsSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:projects|project-selected|project-summary-populated|project-stats-populated|project workspace|project stats|projects?)\b/i.test(seedText(seedPlan, targetAppId));
}

function shouldApplyFeedSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:feed|feed|timeline|activity|updates?|posts?|commit activity)\b/i.test(seedText(seedPlan, targetAppId));
}

function demoFeedbackItems(): FeedbackItem[] {
  const now = new Date();
  return [
    {
      id: "capture-feedback-1",
      author: { name: "Maya", type: "user" },
      title: "Show model quality badges in the chat picker",
      body: "Make the newest model easier to identify before starting an agent conversation.",
      category: "feature_request",
      status: "in_progress",
      product: "aura",
      upvotes: 42,
      downvotes: 1,
      voteScore: 41,
      viewerVote: "up",
      commentCount: 2,
      createdAt: new Date(now.getTime() - 86_400_000).toISOString(),
    },
    {
      id: "capture-feedback-2",
      author: { name: "Release Scout", type: "agent" },
      title: "Add changelog media proof before publish",
      body: "Automatically attach a verified product image when a release note has a visual desktop change.",
      category: "ui_ux",
      status: "in_review",
      product: "aura",
      upvotes: 31,
      downvotes: 0,
      voteScore: 31,
      viewerVote: "none",
      commentCount: 1,
      createdAt: new Date(now.getTime() - 172_800_000).toISOString(),
    },
    {
      id: "capture-feedback-3",
      author: { name: "Jordan", type: "user" },
      title: "Keep feedback threads visible beside the board",
      body: "The sidekick should retain the selected thread while the board is filtered.",
      category: "feedback",
      status: "deployed",
      product: "aura",
      upvotes: 18,
      downvotes: 0,
      voteScore: 18,
      viewerVote: "none",
      commentCount: 3,
      createdAt: new Date(now.getTime() - 259_200_000).toISOString(),
    },
  ];
}

function demoFeedbackComments(): FeedbackComment[] {
  const now = new Date();
  return [
    {
      id: "capture-feedback-comment-1",
      itemId: "capture-feedback-1",
      author: { name: "Release Scout", type: "agent" },
      text: "Seeded proof should show the picker label, the selected agent, and enough product context.",
      createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
    },
    {
      id: "capture-feedback-comment-2",
      itemId: "capture-feedback-1",
      author: { name: "Maya", type: "user" },
      text: "This is the exact kind of visual proof we want in the changelog.",
      createdAt: new Date(now.getTime() - 1_800_000).toISOString(),
    },
    {
      id: "capture-feedback-comment-3",
      itemId: "capture-feedback-2",
      author: { name: "Aura Guide", type: "agent" },
      text: "Capture runs now omit failed media instead of publishing placeholders.",
      createdAt: new Date(now.getTime() - 5_400_000).toISOString(),
    },
  ];
}

async function seedFeedbackBoard(): Promise<void> {
  const { useFeedbackStore } = await import("../stores/feedback-store");
  const items = demoFeedbackItems();
  useFeedbackStore.setState({
    items,
    comments: demoFeedbackComments(),
    sort: "popular",
    categoryFilter: null,
    statusFilter: null,
    productFilter: "aura",
    selectedId: items[0]?.id ?? null,
    isLoading: false,
    hasLoaded: true,
    loadError: null,
    isSubmitting: false,
    isComposerOpen: false,
    composerError: null,
    commentsLoadedFor: new Set(items.map((item) => item.id)),
  });
}

function demoNotesTree(): NotesTreeNode[] {
  const now = new Date().toISOString();
  return [
    {
      kind: "folder",
      name: "Release Notes",
      relPath: "Release Notes",
      children: [
        {
          kind: "note",
          name: DEMO_NOTE_PATH,
          relPath: DEMO_NOTE_PATH,
          absPath: `/workspace/aura-launch/notes/${DEMO_NOTE_PATH}`,
          title: "Launch Plan",
          updatedAt: now,
        },
        {
          kind: "note",
          name: "QA Gates.md",
          relPath: "QA Gates.md",
          absPath: "/workspace/aura-launch/notes/QA Gates.md",
          title: "QA Gates",
          updatedAt: now,
        },
      ],
    },
  ];
}

function demoNoteContent() {
  const now = new Date().toISOString();
  const content = `---
created_by: Release Scout
created_at: 2026-04-25
---

# Launch Plan

## Visual proof checklist

- Seed the target app with realistic data before Browser Use navigates.
- Keep the sitemap focused on durable product surfaces and data-agent handles.
- Publish only screenshots that pass raw quality, vision relevance, and branded preservation gates.

## Recovery

If a media candidate fails, the changelog stays text-only and the asset is omitted entirely.`;
  return {
    content,
    title: "Launch Plan",
    frontmatter: {
      created_by: "Release Scout",
      created_at: "2026-04-25",
    },
    absPath: `/workspace/aura-launch/notes/${DEMO_NOTE_PATH}`,
    updatedAt: now,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    dirty: false,
  };
}

async function seedNotesWorkspace(): Promise<void> {
  const { useNotesStore, makeNoteKey } = await import("../stores/notes-store");
  const key = makeNoteKey(DEMO_PROJECT_ID, DEMO_NOTE_PATH);
  useNotesStore.setState((state) => ({
    trees: {
      ...state.trees,
      [DEMO_PROJECT_ID]: {
        nodes: demoNotesTree(),
        root: "/workspace/aura-launch/notes",
        loading: false,
        titleOverrides: {},
      },
    },
    contentCache: {
      ...state.contentCache,
      [key]: demoNoteContent(),
    },
    commentsByNote: {
      ...state.commentsByNote,
      [key]: [
        {
          id: "capture-note-comment-1",
          authorId: "capture-demo-user",
          authorName: "Maya",
          body: "This note gives the screenshot agent the exact populated surface to prove.",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    activeProjectId: DEMO_PROJECT_ID,
    activeRelPath: DEMO_NOTE_PATH,
    sidekickTab: "toc",
  }));
}

function demoTasks(): Task[] {
  const now = new Date().toISOString();
  const base = {
    project_id: DEMO_PROJECT_ID,
    spec_id: "capture-demo-spec",
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: DEMO_AGENT_INSTANCE_ID,
    completed_by_agent_instance_id: null,
    session_id: "capture-demo-session",
    files_changed: [],
    live_output: "",
    user_id: "capture-demo-user",
    model: AURA_MANAGED_CHAT_MODELS[0]?.id ?? "default",
    total_input_tokens: 2400,
    total_output_tokens: 820,
    created_at: now,
    updated_at: now,
  } satisfies Omit<Task, "task_id" | "title" | "description" | "status" | "order_index" | "execution_notes">;
  return [
    {
      ...base,
      task_id: "capture-demo-task-1",
      title: "Infer media-worthy changelog entries",
      description: "Classify desktop UI changes and skip backend-only commits.",
      status: "done",
      order_index: 1,
      execution_notes: "Planner selected only visible desktop proof candidates.",
      completed_by_agent_instance_id: DEMO_AGENT_INSTANCE_ID,
    },
    {
      ...base,
      task_id: "capture-demo-task-2",
      title: "Seed app data before capture",
      description: "Populate the selected surface so screenshots never show black shells.",
      status: "in_progress",
      order_index: 2,
      execution_notes: "Capture session is using seeded project, agent, and product state.",
    },
    {
      ...base,
      task_id: "capture-demo-task-3",
      title: "Run branded media quality gates",
      description: "Reject blurry, irrelevant, or placeholder screenshots before publish.",
      status: "ready",
      order_index: 3,
      execution_notes: "Waiting on final vision judge.",
    },
  ];
}

async function seedTaskBoard(): Promise<void> {
  const { useKanbanStore } = await import("../apps/tasks/stores/kanban-store");
  useKanbanStore.setState((state) => ({
    tasksByProject: {
      ...state.tasksByProject,
      [DEMO_PROJECT_ID]: {
        tasks: demoTasks(),
        fetchedAt: Date.now(),
      },
    },
    loading: {
      ...state.loading,
      [DEMO_PROJECT_ID]: false,
    },
  }));
}

function demoProcesses(): Process[] {
  const now = new Date().toISOString();
  return [
    {
      process_id: DEMO_PROCESS_ID,
      org_id: "capture-demo-org",
      user_id: "capture-demo-user",
      project_id: DEMO_PROJECT_ID,
      name: "Changelog Media QA",
      description: "Plans, seeds, captures, and reviews changelog media before publication.",
      enabled: true,
      folder_id: null,
      schedule: "Every release",
      tags: ["changelog", "media", "quality"],
      last_run_at: now,
      next_run_at: null,
      created_at: now,
      updated_at: now,
    },
  ];
}

function demoProcessNodes(): ProcessNode[] {
  const now = new Date().toISOString();
  return [
    {
      node_id: "capture-node-plan",
      process_id: DEMO_PROCESS_ID,
      node_type: "prompt",
      label: "Plan from changelog",
      agent_id: "capture-demo-project-agent",
      prompt: "Infer the most visual desktop change and choose the seeded surface.",
      config: {},
      position_x: 120,
      position_y: 160,
      created_at: now,
      updated_at: now,
    },
    {
      node_id: "capture-node-seed",
      process_id: DEMO_PROCESS_ID,
      node_type: "action",
      label: "Seed product data",
      agent_id: "capture-demo-project-agent",
      prompt: "Populate the target app with realistic demo data before capture.",
      config: {},
      position_x: 420,
      position_y: 160,
      created_at: now,
      updated_at: now,
    },
    {
      node_id: "capture-node-review",
      process_id: DEMO_PROCESS_ID,
      node_type: "artifact",
      label: "Review media gates",
      agent_id: "capture-demo-project-agent",
      prompt: "Validate crispness, relevance, and branded preservation.",
      config: {},
      position_x: 720,
      position_y: 160,
      created_at: now,
      updated_at: now,
    },
  ];
}

function demoProcessConnections(): ProcessNodeConnection[] {
  return [
    {
      connection_id: "capture-connection-plan-seed",
      process_id: DEMO_PROCESS_ID,
      source_node_id: "capture-node-plan",
      source_handle: null,
      target_node_id: "capture-node-seed",
      target_handle: null,
    },
    {
      connection_id: "capture-connection-seed-review",
      process_id: DEMO_PROCESS_ID,
      source_node_id: "capture-node-seed",
      source_handle: null,
      target_node_id: "capture-node-review",
      target_handle: null,
    },
  ];
}

function demoProcessRuns(): ProcessRun[] {
  const now = new Date();
  return [
    {
      run_id: DEMO_PROCESS_RUN_ID,
      process_id: DEMO_PROCESS_ID,
      status: "running",
      trigger: "manual",
      error: null,
      started_at: new Date(now.getTime() - 240_000).toISOString(),
      completed_at: null,
      total_input_tokens: 9200,
      total_output_tokens: 2100,
      cost_usd: 0.38,
      output: "Seeded capture run is validating media quality.",
      parent_run_id: null,
      input_override: null,
    },
  ];
}

function demoProcessEvents(): ProcessEvent[] {
  const now = new Date();
  return [
    {
      event_id: "capture-event-plan",
      run_id: DEMO_PROCESS_RUN_ID,
      node_id: "capture-node-plan",
      process_id: DEMO_PROCESS_ID,
      status: "completed",
      input_snapshot: "Latest changelog entries and changed files.",
      output: "Selected one desktop UI candidate with high confidence.",
      started_at: new Date(now.getTime() - 220_000).toISOString(),
      completed_at: new Date(now.getTime() - 180_000).toISOString(),
      input_tokens: 4200,
      output_tokens: 860,
      model: AURA_MANAGED_CHAT_MODELS[0]?.id ?? "default",
      content_blocks: [{ type: "text", text: "Planner selected a seeded desktop surface." }],
    },
    {
      event_id: "capture-event-seed",
      run_id: DEMO_PROCESS_RUN_ID,
      node_id: "capture-node-seed",
      process_id: DEMO_PROCESS_ID,
      status: "running",
      input_snapshot: "Seed plan and target route.",
      output: "Applying demo data before Browser Use capture.",
      started_at: new Date(now.getTime() - 160_000).toISOString(),
      completed_at: null,
      input_tokens: 2200,
      output_tokens: 540,
      model: AURA_MANAGED_CHAT_MODELS[0]?.id ?? "default",
      content_blocks: [{ type: "text", text: "Seeded state prevents black or empty shells." }],
    },
  ];
}

async function seedProcessWorkflow(): Promise<void> {
  const { useProcessStore, LAST_PROCESS_ID_KEY } = await import("../apps/process/stores/process-store");
  const processes = demoProcesses();
  const nodes = demoProcessNodes();
  const connections = demoProcessConnections();
  const runs = demoProcessRuns();
  const events = demoProcessEvents();
  useProcessStore.setState((state) => ({
    processes: [
      ...processes,
      ...state.processes.filter((process) => !processes.some((demo) => demo.process_id === process.process_id)),
    ],
    loading: false,
    nodes: {
      ...state.nodes,
      [DEMO_PROCESS_ID]: nodes,
    },
    connections: {
      ...state.connections,
      [DEMO_PROCESS_ID]: connections,
    },
    runs: {
      ...state.runs,
      [DEMO_PROCESS_ID]: runs,
    },
    events: {
      ...state.events,
      [DEMO_PROCESS_RUN_ID]: events,
    },
    lastViewedRunId: {
      ...state.lastViewedRunId,
      [DEMO_PROCESS_ID]: DEMO_PROCESS_RUN_ID,
    },
    viewports: {
      ...state.viewports,
      [DEMO_PROCESS_ID]: { x: 40, y: 80, zoom: 0.92 },
    },
  }));
  try {
    window.localStorage.setItem(LAST_PROCESS_ID_KEY, DEMO_PROCESS_ID);
  } catch {
    // Ignore capture-only persistence failures.
  }
}

async function seedFeedTimeline(): Promise<void> {
  const { useFeedStore } = await import("../stores/feed-store");
  const now = new Date();
  useFeedStore.setState({
    liveEvents: [
      {
        id: "capture-feed-event-1",
        postType: "push",
        title: "Changelog media pipeline hardened",
        author: { name: "Release Scout", type: "agent", status: "working" },
        repo: "cypher-asi/aura-os",
        branch: "main",
        commits: [
          { sha: "a17c9e2", message: "Seed changelog capture state before Browser Use" },
          { sha: "d04f7b1", message: "Preserve high-resolution branded screenshots" },
        ],
        commitIds: ["a17c9e2", "d04f7b1"],
        pushId: "capture-feed-push",
        timestamp: new Date(now.getTime() - 900_000).toISOString(),
        summary: "The media job now seeds app data, validates relevance, and omits failed assets.",
        eventType: "push",
        profileId: "capture-demo-release-agent",
        orgId: "capture-demo-org",
        commentCount: 2,
      },
      {
        id: "capture-feed-event-2",
        postType: "post",
        title: "Daily update ready",
        author: { name: "Maya", type: "user" },
        repo: "cypher-asi/aura-os",
        branch: "main",
        commits: [],
        commitIds: [],
        timestamp: new Date(now.getTime() - 1_800_000).toISOString(),
        summary: "Planner, sitemap, and seed contracts are ready for desktop proof capture.",
        eventType: "post",
        profileId: "capture-demo-user",
        orgId: "capture-demo-org",
        commentCount: 1,
      },
    ],
    filter: "everything",
    selectedEventId: "capture-feed-event-1",
    selectedProfile: null,
    userAvatarUrl: undefined,
  });
}

async function seedAgentActivity(agentId: string): Promise<void> {
  const { useLoopActivityStore } = await import("../stores/loop-activity-store");
  const now = new Date().toISOString();
  useLoopActivityStore.getState().upsert(
    {
      user_id: "capture-demo-user",
      agent_id: agentId,
      kind: "chat",
      instance: "capture-demo-agent-loop",
    },
    {
      status: "running",
      percent: 34,
      started_at: now,
      last_event_at: now,
      current_step: "Reviewing release proof",
    },
  );
}

function demoImageDataUri(variant = 0): string {
  const palette = [
    {
      name: "Aurora Habitat",
      bg0: "#09111f",
      bg1: "#223a76",
      bg2: "#070a16",
      front0: "#e0f2fe",
      front1: "#38bdf8",
      side0: "#60a5fa",
      side1: "#1e3a8a",
    },
    {
      name: "Glass Rover",
      bg0: "#100b1f",
      bg1: "#4c1d95",
      bg2: "#09090b",
      front0: "#f5d0fe",
      front1: "#a855f7",
      side0: "#c084fc",
      side1: "#581c87",
    },
    {
      name: "Lunar Drone",
      bg0: "#061813",
      bg1: "#115e59",
      bg2: "#020617",
      front0: "#ccfbf1",
      front1: "#14b8a6",
      side0: "#5eead4",
      side1: "#134e4a",
    },
  ][variant % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.bg0}"/>
      <stop offset="0.48" stop-color="${palette.bg1}"/>
      <stop offset="1" stop-color="${palette.bg2}"/>
    </linearGradient>
    <radialGradient id="spot" cx="50%" cy="36%" r="46%">
      <stop offset="0" stop-color="#dbeafe" stop-opacity="0.95"/>
      <stop offset="0.42" stop-color="#60a5fa" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#1d4ed8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.front0}"/>
      <stop offset="1" stop-color="${palette.front1}"/>
    </linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.side0}"/>
      <stop offset="1" stop-color="${palette.side1}"/>
    </linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#93c5fd"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#bg)"/>
  <rect width="1600" height="1000" fill="url(#spot)"/>
  <ellipse cx="805" cy="760" rx="390" ry="88" fill="#020617" opacity="0.42" filter="url(#soft)"/>
  <polygon points="805,190 1125,370 805,550 485,370" fill="url(#top)" opacity="0.96"/>
  <polygon points="485,370 805,550 805,810 485,625" fill="url(#front)" opacity="0.94"/>
  <polygon points="1125,370 805,550 805,810 1125,620" fill="url(#side)" opacity="0.96"/>
  <path d="M805 190v360M485 370v255M1125 370v250M805 810V550" stroke="#eff6ff" stroke-width="8" opacity="0.38"/>
  <circle cx="1010" cy="268" r="58" fill="#ffffff" opacity="0.74"/>
  <circle cx="1010" cy="268" r="96" fill="#93c5fd" opacity="0.22"/>
  <path d="M605 646c118 72 282 72 400 0" fill="none" stroke="#dbeafe" stroke-width="18" stroke-linecap="round" opacity="0.5"/>
  <path d="M632 695c100 48 246 48 346 0" fill="none" stroke="#bfdbfe" stroke-width="10" stroke-linecap="round" opacity="0.38"/>
  <text x="96" y="118" fill="#f8fafc" font-family="ui-sans-serif, system-ui, sans-serif" font-size="46" font-weight="720" opacity="0.96">${palette.name}</text>
  <text x="98" y="172" fill="#cbd5e1" font-family="ui-sans-serif, system-ui, sans-serif" font-size="26" font-weight="520" opacity="0.82">Seeded AURA 3D generated asset</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function demoAura3DImages() {
  const prompts = [
    "Aurora habitat module with translucent glass panels",
    "Glass rover concept for a cinematic launch scene",
    "Lunar drone generated asset with teal studio lighting",
  ];
  return prompts.map((prompt, index) => {
    const imageUrl = demoImageDataUri(index);
    return {
      id: index === 0 ? "capture-demo-image" : `capture-demo-image-${index + 1}`,
      artifactId: index === 0 ? "capture-demo-image-artifact" : `capture-demo-image-artifact-${index + 1}`,
      prompt,
      imageUrl,
      originalUrl: imageUrl,
      model: "gpt-image-2",
      createdAt: new Date(Date.now() - (index * 60_000)).toISOString(),
      meta: { captureDemo: true },
    };
  });
}

export async function applyAuraCaptureSeedPlan(
  seedPlan: AuraCaptureSeedPlan | null | undefined,
  targetAppId: string | null,
): Promise<Record<string, unknown>> {
  const applied: string[] = [];
  const capabilities = seedCapabilities(seedPlan);

  if (capabilities.includes("project-selected") || shouldApplyAura3DSeed(seedPlan, targetAppId)) {
    await seedDemoProject();
    applied.push("capture-demo-project");
  }

  if (shouldApplyProjectsSeed(seedPlan, targetAppId)) {
    await seedDemoProject();
    if (capabilities.includes("project-stats-populated")) {
      applied.push("project-demo-stats");
    }
    if (capabilities.includes("project-summary-populated")) {
      applied.push("project-demo-summary");
    }
  }

  if (shouldApplyFeedbackSeed(seedPlan, targetAppId)) {
    await seedFeedbackBoard();
    applied.push("feedback-demo-board");
  }

  if (shouldApplyNotesSeed(seedPlan, targetAppId)) {
    await seedDemoProject();
    await seedNotesWorkspace();
    applied.push("capture-demo-project");
    applied.push("notes-demo-workspace");
  }

  if (shouldApplyTasksSeed(seedPlan, targetAppId)) {
    await seedDemoProject();
    await seedTaskBoard();
    applied.push("capture-demo-project");
    applied.push("tasks-demo-board");
  }

  if (shouldApplyProcessSeed(seedPlan, targetAppId)) {
    await seedDemoProject();
    await seedProcessWorkflow();
    applied.push("capture-demo-project");
    applied.push("process-demo-workflow");
  }

  if (shouldApplyFeedSeed(seedPlan, targetAppId)) {
    await seedFeedTimeline();
    applied.push("feed-demo-timeline");
  }

  if (shouldApplyAura3DSeed(seedPlan, targetAppId)) {
    const { useAura3DStore } = await import("../stores/aura3d-store");
    const openModelSurface = shouldOpenAura3DModelSurface(seedPlan);
    const images = demoAura3DImages();
    const image = images[0];
    useAura3DStore.setState((state) => ({
      selectedProjectId: DEMO_PROJECT_ID,
      activeTab: openModelSurface ? "3d" : "image",
      imaginePrompt: image.prompt,
      imagineModel: "gpt-image-2",
      isGeneratingImage: false,
      imageProgress: 100,
      imageProgressMessage: "Ready",
      partialImageData: null,
      currentImage: image,
      generateSourceImage: image,
      current3DModel: null,
      images,
      models: [],
      selectedImageId: image.id,
      selectedModelId: null,
      sidekickTab: "images",
      error: null,
      isLoadingArtifacts: false,
      loadedProjectIds: new Set([...state.loadedProjectIds, DEMO_PROJECT_ID]),
    }));
    applied.push(openModelSurface ? "aura3d-demo-source-image-for-3d" : "aura3d-demo-generated-image");
  }

  if (shouldApplyAgentChatSeed(seedPlan, targetAppId)) {
    const { useAgentStore } = await import("../apps/agents/stores");
    const { useMessageStore } = await import("../stores/message-store");
    const { useChatUIStore } = await import("../stores/chat-ui-store");
    const { useChatHistoryStore, agentHistoryKey } = await import("../stores/chat-history-store");
    const { useAgentSidekickStore } = await import("../apps/agents/stores/agent-sidekick-store");
    const seedModel = resolveSeedChatModel(seedPlan, targetAppId);
    const agent = demoAgent(seedModel.id);
    const agents = demoSidebarAgents(seedModel.id);
    const messages = demoAgentMessages();
    const now = Date.now();
    const lastMessageAt = new Date(now).toISOString();
    useAgentStore.setState((state) => ({
      agents: [
        ...agents,
        ...state.agents.filter((candidate) => !agents.some((demo) => demo.agent_id === candidate.agent_id)),
      ],
      agentsStatus: "ready",
      agentsError: null,
      selectedAgentId: agent.agent_id,
      history: {
        ...state.history,
        [agent.agent_id]: {
          events: messages,
          status: "ready",
          fetchedAt: Date.now(),
          error: null,
        },
      },
    }));
    useMessageStore.getState().setThread(agent.agent_id, messages);
    useChatHistoryStore.setState((state) => ({
      entries: {
        ...state.entries,
        [agentHistoryKey(agent.agent_id)]: {
          events: messages,
          status: "ready",
          fetchedAt: now,
          error: null,
          lastMessageAt,
        },
      },
    }));
    useChatUIStore.getState().setSelectedModel(agent.agent_id, seedModel.id, "default", agent.agent_id);
    useAgentSidekickStore.setState({
      activeTab: "profile",
      previewItem: null,
      previewHistory: [],
      canGoBack: false,
      showEditor: false,
      showDeleteConfirm: false,
    });
    useAgentStore.getState().setSelectedAgent(agent.agent_id);
    if (shouldApplyAgentActivitySeed(seedPlan, targetAppId)) {
      await seedAgentActivity(agent.agent_id);
    }
    try {
      window.localStorage.setItem("aura:lastAgentId", agent.agent_id);
    } catch {
      // Ignore capture-only persistence failures.
    }
    applied.push(`agent-chat-demo-model-picker:${seedModel.id}`);
  }

  return {
    ok: true,
    applied,
    capabilities: seedPlan?.capabilities ?? [],
  };
}
