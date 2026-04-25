import { create } from "zustand";
import type { ReactNode } from "react";
import type { AgentInstance, Spec, Task, Session } from "../shared/types";
import type { LogEntry } from "../hooks/use-log-stream";
import { compareSpecs } from "../utils/collections";
import {
  createSidekickSlice,
  persistActiveTab,
  type SidekickSliceState,
} from "./shared/sidekick-slice";
import { SIDEKICK_ACTIVE_TAB_KEY } from "../constants";

export type SidekickTab =
  | "terminal"
  | "browser"
  | "run"
  | "specs"
  | "tasks"
  | "stats"
  | "sessions"
  | "log"
  | "files";

const SIDEKICK_TABS = new Set<SidekickTab>([
  "terminal",
  "browser",
  "run",
  "specs",
  "tasks",
  "stats",
  "sessions",
  "log",
  "files",
]);

function isSidekickTab(value: string): value is SidekickTab {
  return SIDEKICK_TABS.has(value as SidekickTab);
}

export type PreviewItem =
  | { kind: "spec"; spec: Spec }
  | { kind: "specs_overview"; specs: Spec[] }
  | { kind: "task"; task: Task }
  | { kind: "session"; session: Session }
  | { kind: "log"; entry: LogEntry };

type AgentInstanceUpdateListener = (instance: AgentInstance) => void;

interface SidekickState extends SidekickSliceState<SidekickTab, PreviewItem> {
  infoContent: ReactNode;
  showInfo: boolean;
  specs: Spec[];
  tasks: Task[];
  deletedSpecIds: string[];
  deletedTaskIds: string[];
  /**
   * Source of truth for "which agent instances are currently
   * mid-turn from this client". Multi-value so the UI can correctly
   * surface concurrent streams across agents/projects (chat in
   * project A while a parallel chat / loop runs in project B). Use
   * the `useIsAgentStreaming(id)` selector to compare against a
   * specific agent instance.
   */
  streamingAgentInstanceIds: string[];
  /**
   * Backwards-compat single-string view: most-recently-added entry
   * from `streamingAgentInstanceIds`, or `null` if the set is empty.
   * Existing call sites that only need a truthy "is anything
   * streaming?" signal can keep reading this; equality checks
   * against a specific id should migrate to `useIsAgentStreaming`.
   */
  streamingAgentInstanceId: string | null;

  viewSpec: (spec: Spec) => void;
  viewTask: (task: Task) => void;
  viewSession: (session: Session) => void;
  goBackPreview: () => void;
  closePreview: () => void;
  toggleInfo: (title: string, content: ReactNode) => void;
  pushSpec: (spec: Spec) => void;
  removeSpec: (specId: string) => void;
  clearDeletedSpecs: () => void;
  pushTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  clearDeletedTasks: () => void;
  clearGeneratedArtifacts: () => void;
  /**
   * Add or remove a single agent instance from the streaming set.
   * Preferred over `setStreamingAgentInstanceId` — this is the
   * primitive that supports multiple concurrent streams.
   */
  setAgentStreaming: (agentInstanceId: string, streaming: boolean) => void;
  /**
   * @deprecated for new code; prefer `setAgentStreaming`. Retained
   * because tests and a few legacy callers still use the
   * single-string signature. `id != null` adds the id to the set;
   * `id == null` clears the entire set (legacy semantic).
   */
  setStreamingAgentInstanceId: (id: string | null) => void;
  notifyAgentInstanceUpdate: (instance: AgentInstance) => void;
  onAgentInstanceUpdate: (listener: AgentInstanceUpdateListener) => () => void;
  patchTask: (taskId: string, patch: Partial<Task>) => void;
  updatePreviewTask: (patch: Partial<Task> & { task_id: string }) => void;
  updatePreviewSpecs: (specs: Spec[]) => void;
}

function isTerminalTaskStatus(status: Task["status"] | undefined): boolean {
  return status === "done" || status === "failed";
}

// Preserve a terminal (done/failed) status against stale `task_saved` snapshots
// that may arrive from storage after `task_completed`/`task_failed` has already
// landed on the client (see dev_loop.rs -> runtime.rs::emit_tool_saved_completion).
function preserveTerminalStatus(existing: Task | undefined, incoming: Task): Task {
  if (!existing) return incoming;
  if (!isTerminalTaskStatus(existing.status)) return incoming;
  if (isTerminalTaskStatus(incoming.status)) return incoming;
  return {
    ...incoming,
    status: existing.status,
    execution_notes: existing.execution_notes ?? incoming.execution_notes,
    files_changed: existing.files_changed ?? incoming.files_changed,
  };
}

function patchTaskInHistory(
  history: PreviewItem[],
  taskId: string,
  patch: Partial<Task> | Task,
): PreviewItem[] {
  let changed = false;
  const next = history.map((item) => {
    if (item.kind !== "task" || item.task.task_id !== taskId) return item;
    changed = true;
    return { kind: "task" as const, task: { ...item.task, ...patch } };
  });
  return changed ? next : history;
}

function patchSpecInHistory(
  history: PreviewItem[],
  specId: string,
  patch: Partial<Spec> | Spec,
): PreviewItem[] {
  let changed = false;
  const next = history.map((item) => {
    if (item.kind !== "spec" || item.spec.spec_id !== specId) return item;
    changed = true;
    return { kind: "spec" as const, spec: { ...item.spec, ...patch } };
  });
  return changed ? next : history;
}

const titleListeners = new Set<AgentInstanceUpdateListener>();

export const useSidekickStore = create<SidekickState>()((set, get) => ({
  ...createSidekickSlice<SidekickTab, PreviewItem>("terminal", set, get, {
    storageKey: SIDEKICK_ACTIVE_TAB_KEY,
    isValidTab: isSidekickTab,
  }),
  infoContent: null,
  showInfo: false,
  specs: [],
  tasks: [],
  deletedSpecIds: [],
  deletedTaskIds: [],
  streamingAgentInstanceIds: [],
  streamingAgentInstanceId: null,

  setActiveTab: (tab) => {
    persistActiveTab(SIDEKICK_ACTIVE_TAB_KEY, tab);
    set({ activeTab: tab, showInfo: false, previewItem: null, previewHistory: [], canGoBack: false });
  },

  viewSpec: (spec) => {
    set({ previewItem: { kind: "spec", spec }, previewHistory: [], canGoBack: false });
  },

  viewTask: (task) => {
    set({ previewItem: { kind: "task", task }, previewHistory: [], canGoBack: false });
  },

  viewSession: (session) => {
    set({ previewItem: { kind: "session", session }, previewHistory: [], canGoBack: false });
  },

  goBackPreview: () => {
    const { previewHistory, tasks } = get();
    if (previewHistory.length === 0) return;
    const history = [...previewHistory];
    const popped = history.pop();
    if (!popped) return;
    let previousItem: PreviewItem = popped;
    if (previousItem.kind === "task") {
      const prevTask = previousItem.task;
      const fresh = tasks.find((t) => t.task_id === prevTask.task_id);
      if (fresh) previousItem = { kind: "task", task: { ...prevTask, ...fresh } };
    }
    set({ previewItem: previousItem, previewHistory: history, canGoBack: history.length > 0 });
  },

  closePreview: () => get().clearPreviews(),

  toggleInfo: (_title, content) => {
    const { showInfo } = get();
    if (showInfo) {
      set({ showInfo: false, infoContent: null });
    } else {
      set({ showInfo: true, infoContent: content });
    }
  },

  pushSpec: (spec) => {
    const { specs, deletedSpecIds, previewItem, previewHistory } = get();
    // When a *real* spec arrives (backend-issued id, not a pending
    // placeholder), evict any left-over `pending-*` placeholders whose
    // title matches. Covers the case where an optimistic placeholder was
    // pushed at ToolUseStart/Snapshot but never cleaned up by
    // promotePendingSpec (e.g. stream aborted, unparseable tool result,
    // or SpecSaved landed before the tool result).
    const isReal = !spec.spec_id.startsWith("pending-");
    const base = isReal
      ? specs.filter(
          (s) => !(s.spec_id.startsWith("pending-") && s.title === spec.title),
        )
      : specs;
    const exists = base.some((s) => s.spec_id === spec.spec_id);
    const next = exists
      ? base.map((s) => (s.spec_id === spec.spec_id ? spec : s))
      : [...base, spec];
    let newPreview = previewItem;
    if (previewItem?.kind === "spec" && previewItem.spec.spec_id === spec.spec_id) {
      newPreview = { kind: "spec", spec };
    }
    // If the previewed spec was a now-evicted pending placeholder, move
    // the preview over to the real spec that replaced it.
    if (
      isReal &&
      previewItem?.kind === "spec" &&
      previewItem.spec.spec_id.startsWith("pending-") &&
      previewItem.spec.title === spec.title
    ) {
      newPreview = { kind: "spec", spec };
    }
    const newHistory = patchSpecInHistory(previewHistory, spec.spec_id, spec);
    const nextDeleted = deletedSpecIds.includes(spec.spec_id)
      ? deletedSpecIds.filter((id) => id !== spec.spec_id)
      : deletedSpecIds;
    set({
      specs: next.sort(compareSpecs),
      deletedSpecIds: nextDeleted,
      previewItem: newPreview,
      previewHistory: newHistory,
    });
  },

  removeSpec: (specId) => {
    const { specs, deletedSpecIds, previewItem, previewHistory } = get();
    const isPreviewedSpec = previewItem?.kind === "spec" && previewItem.spec.spec_id === specId;
    const nextHistory = previewHistory.filter(
      (item) => !(item.kind === "spec" && item.spec.spec_id === specId),
    );
    set({
      specs: specs.filter((s) => s.spec_id !== specId),
      deletedSpecIds: deletedSpecIds.includes(specId)
        ? deletedSpecIds
        : [...deletedSpecIds, specId],
      previewItem: isPreviewedSpec ? null : previewItem,
      previewHistory: nextHistory.length === previewHistory.length ? previewHistory : nextHistory,
      canGoBack: isPreviewedSpec ? false : get().canGoBack && nextHistory.length > 0,
    });
  },

  clearDeletedSpecs: () => {
    const { deletedSpecIds } = get();
    if (deletedSpecIds.length === 0) return;
    set({ deletedSpecIds: [] });
  },

  pushTask: (task) => {
    const { tasks, deletedTaskIds, previewItem, previewHistory } = get();
    // Same guard as pushSpec: a real task (non-pending id) evicts any
    // left-over `pending-*` placeholders that share its title.
    const isReal = !task.task_id.startsWith("pending-");
    const baseTasks = isReal
      ? tasks.filter(
          (t) => !(t.task_id.startsWith("pending-") && t.title === task.title),
        )
      : tasks;
    const existing = baseTasks.find((t) => t.task_id === task.task_id);
    const effective = preserveTerminalStatus(existing, task);
    const next = existing
      ? baseTasks.map((t) => (t.task_id === task.task_id ? effective : t))
      : [...baseTasks, effective];
    let newPreview = previewItem;
    if (previewItem?.kind === "task" && previewItem.task.task_id === task.task_id) {
      newPreview = { kind: "task", task: effective };
    }
    if (
      isReal &&
      previewItem?.kind === "task" &&
      previewItem.task.task_id.startsWith("pending-") &&
      previewItem.task.title === task.title
    ) {
      newPreview = { kind: "task", task: effective };
    }
    const newHistory = patchTaskInHistory(previewHistory, task.task_id, effective);
    const nextDeleted = deletedTaskIds.includes(task.task_id)
      ? deletedTaskIds.filter((id) => id !== task.task_id)
      : deletedTaskIds;
    set({
      tasks: next.sort((a, b) => a.order_index - b.order_index),
      deletedTaskIds: nextDeleted,
      previewItem: newPreview,
      previewHistory: newHistory,
    });
  },

  removeTask: (taskId) => {
    const { tasks, deletedTaskIds, previewItem, previewHistory } = get();
    const isPreviewedTask = previewItem?.kind === "task" && previewItem.task.task_id === taskId;
    const nextHistory = previewHistory.filter(
      (item) => !(item.kind === "task" && item.task.task_id === taskId),
    );
    set({
      tasks: tasks.filter((t) => t.task_id !== taskId),
      deletedTaskIds: deletedTaskIds.includes(taskId)
        ? deletedTaskIds
        : [...deletedTaskIds, taskId],
      previewItem: isPreviewedTask ? null : previewItem,
      previewHistory: nextHistory.length === previewHistory.length ? previewHistory : nextHistory,
      canGoBack: isPreviewedTask ? false : get().canGoBack && nextHistory.length > 0,
    });
  },

  clearDeletedTasks: () => {
    const { deletedTaskIds } = get();
    if (deletedTaskIds.length === 0) return;
    set({ deletedTaskIds: [] });
  },

  clearGeneratedArtifacts: () => {
    set({ specs: [], tasks: [] });
  },

  setAgentStreaming: (agentInstanceId, streaming) => {
    if (!agentInstanceId) return;
    set((s) => {
      const has = s.streamingAgentInstanceIds.includes(agentInstanceId);
      if (streaming && has) return s;
      if (!streaming && !has) return s;
      const nextIds = streaming
        ? [...s.streamingAgentInstanceIds, agentInstanceId]
        : s.streamingAgentInstanceIds.filter((id) => id !== agentInstanceId);
      return {
        streamingAgentInstanceIds: nextIds,
        streamingAgentInstanceId: nextIds.length > 0 ? nextIds[nextIds.length - 1] : null,
      };
    });
  },

  setStreamingAgentInstanceId: (id) => {
    if (id == null) {
      set((s) =>
        s.streamingAgentInstanceIds.length === 0 && s.streamingAgentInstanceId === null
          ? s
          : { streamingAgentInstanceIds: [], streamingAgentInstanceId: null },
      );
      return;
    }
    get().setAgentStreaming(id, true);
  },

  notifyAgentInstanceUpdate: (instance) => {
    titleListeners.forEach((fn) => fn(instance));
  },

  onAgentInstanceUpdate: (listener) => {
    titleListeners.add(listener);
    return () => { titleListeners.delete(listener); };
  },

  patchTask: (taskId, patch) => {
    const { tasks } = get();
    const found = tasks.some((t) => t.task_id === taskId);
    if (!found) return;
    set({ tasks: tasks.map((t) => (t.task_id === taskId ? { ...t, ...patch } : t)) });
  },

  updatePreviewTask: (patch) => {
    const { previewItem, previewHistory } = get();
    let newPreview = previewItem;
    if (previewItem?.kind === "task" && previewItem.task.task_id === patch.task_id) {
      newPreview = { kind: "task", task: { ...previewItem.task, ...patch } };
    }
    const newHistory = patchTaskInHistory(previewHistory, patch.task_id, patch);
    if (newPreview === previewItem && newHistory === previewHistory) return;
    set({ previewItem: newPreview, previewHistory: newHistory });
  },

  updatePreviewSpecs: (specs) => {
    const { previewItem } = get();
    if (previewItem?.kind !== "specs_overview") return;
    set({ previewItem: { kind: "specs_overview", specs } });
  },
}));

/**
 * Returns `true` while `agentInstanceId` is in the streaming set.
 * Use this in lists/explorers that need a per-row "is this specific
 * agent currently streaming?" badge — the legacy
 * `streamingAgentInstanceId === agent.id` comparison only worked
 * when at most one agent was active and silently lost the badge for
 * any second concurrent stream.
 */
export function useIsAgentStreaming(agentInstanceId: string | undefined | null): boolean {
  return useSidekickStore((s) =>
    !!agentInstanceId && s.streamingAgentInstanceIds.includes(agentInstanceId),
  );
}

/** True if any agent instance is streaming right now. */
export function useHasAnyStreamingAgent(): boolean {
  return useSidekickStore((s) => s.streamingAgentInstanceIds.length > 0);
}
