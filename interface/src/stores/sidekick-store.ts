import { create } from "zustand";
import type { ReactNode } from "react";
import type { AgentInstance, Spec, Task, Session } from "../types";
import type { LogEntry } from "../hooks/use-log-stream";
import { compareSpecs } from "../utils/collections";
import { createSidekickSlice, type SidekickSliceState } from "./shared/sidekick-slice";

export type SidekickTab = "specs" | "tasks" | "stats" | "sessions" | "log" | "files";

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
  clearGeneratedArtifacts: () => void;
  setStreamingAgentInstanceId: (id: string | null) => void;
  notifyAgentInstanceUpdate: (instance: AgentInstance) => void;
  onAgentInstanceUpdate: (listener: AgentInstanceUpdateListener) => () => void;
  patchTask: (taskId: string, patch: Partial<Task>) => void;
  updatePreviewTask: (patch: Partial<Task> & { task_id: string }) => void;
  updatePreviewSpecs: (specs: Spec[]) => void;
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
  ...createSidekickSlice<SidekickTab, PreviewItem>("specs", set, get),
  infoContent: null,
  showInfo: false,
  specs: [],
  tasks: [],
  deletedSpecIds: [],
  streamingAgentInstanceId: null,

  setActiveTab: (tab) => {
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
    const { specs, previewItem, previewHistory } = get();
    const exists = specs.some((s) => s.spec_id === spec.spec_id);
    const next = exists
      ? specs.map((s) => (s.spec_id === spec.spec_id ? spec : s))
      : [...specs, spec];
    let newPreview = previewItem;
    if (previewItem?.kind === "spec" && previewItem.spec.spec_id === spec.spec_id) {
      newPreview = { kind: "spec", spec };
    }
    const newHistory = patchSpecInHistory(previewHistory, spec.spec_id, spec);
    set({
      specs: next.sort(compareSpecs),
      previewItem: newPreview,
      previewHistory: newHistory,
    });
  },

  removeSpec: (specId) => {
    const { specs, deletedSpecIds } = get();
    set({
      specs: specs.filter((s) => s.spec_id !== specId),
      deletedSpecIds: deletedSpecIds.includes(specId)
        ? deletedSpecIds
        : [...deletedSpecIds, specId],
    });
  },

  clearDeletedSpecs: () => {
    const { deletedSpecIds } = get();
    if (deletedSpecIds.length === 0) return;
    set({ deletedSpecIds: [] });
  },

  pushTask: (task) => {
    const { tasks, previewItem, previewHistory } = get();
    const exists = tasks.some((t) => t.task_id === task.task_id);
    const next = exists
      ? tasks.map((t) => (t.task_id === task.task_id ? task : t))
      : [...tasks, task];
    let newPreview = previewItem;
    if (previewItem?.kind === "task" && previewItem.task.task_id === task.task_id) {
      newPreview = { kind: "task", task };
    }
    const newHistory = patchTaskInHistory(previewHistory, task.task_id, task);
    set({
      tasks: next.sort((a, b) => a.order_index - b.order_index),
      previewItem: newPreview,
      previewHistory: newHistory,
    });
  },

  removeTask: (taskId) => {
    const { tasks } = get();
    set({ tasks: tasks.filter((t) => t.task_id !== taskId) });
  },

  clearGeneratedArtifacts: () => {
    set({ specs: [], tasks: [] });
  },

  setStreamingAgentInstanceId: (id) => {
    set({ streamingAgentInstanceId: id });
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
