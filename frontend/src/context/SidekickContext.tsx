import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";
import type { AgentInstance, Spec, Task, Session } from "../types";
import type { LogEntry } from "../hooks/use-log-stream";

export type SidekickTab = "specs" | "tasks" | "stats" | "sessions" | "log" | "files";

export type PreviewItem =
  | { kind: "spec"; spec: Spec }
  | { kind: "specs_overview"; specs: Spec[] }
  | { kind: "task"; task: Task }
  | { kind: "session"; session: Session }
  | { kind: "log"; entry: LogEntry };

interface PanelState {
  activeTab: SidekickTab;
  previewItem: PreviewItem | null;
  previewHistory: PreviewItem[];
  infoContent: ReactNode;
  showInfo: boolean;
  specs: Spec[];
  tasks: Task[];
  /** Spec IDs deleted this session so the sidebar can hide them until next refetch */
  deletedSpecIds: string[];
  streamingAgentInstanceId: string | null;
}

type AgentInstanceUpdateListener = (instance: AgentInstance) => void;

interface PanelActions {
  setActiveTab: (tab: SidekickTab) => void;
  viewSpec: (spec: Spec) => void;
  viewTask: (task: Task) => void;
  viewSession: (session: Session) => void;
  pushPreview: (item: PreviewItem) => void;
  goBackPreview: () => void;
  canGoBack: boolean;
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

type SidekickContextValue = PanelState & PanelActions;

const INITIAL_PANEL: PanelState = {
  activeTab: "specs",
  previewItem: null,
  previewHistory: [],
  infoContent: null,
  showInfo: false,
  specs: [],
  tasks: [],
  deletedSpecIds: [],
  streamingAgentInstanceId: null,
};

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

const SidekickContext = createContext<SidekickContextValue | null>(null);

export function SidekickProvider({ children }: { children: React.ReactNode }) {
  const [panel, setPanel] = useState<PanelState>(INITIAL_PANEL);
  const titleListeners = useRef<Set<AgentInstanceUpdateListener>>(new Set());

  const setActiveTab = useCallback((tab: SidekickTab) => {
    setPanel((prev) => ({ ...prev, activeTab: tab, showInfo: false }));
  }, []);

  const viewSpec = useCallback((spec: Spec) => {
    setPanel((prev) => ({ ...prev, previewItem: { kind: "spec", spec }, previewHistory: [] }));
  }, []);

  const viewTask = useCallback((task: Task) => {
    setPanel((prev) => ({ ...prev, previewItem: { kind: "task", task }, previewHistory: [] }));
  }, []);

  const viewSession = useCallback((session: Session) => {
    setPanel((prev) => ({ ...prev, previewItem: { kind: "session", session }, previewHistory: [] }));
  }, []);

  const pushPreview = useCallback((item: PreviewItem) => {
    setPanel((prev) => ({
      ...prev,
      previewHistory: prev.previewItem ? [...prev.previewHistory, prev.previewItem] : prev.previewHistory,
      previewItem: item,
    }));
  }, []);

  const goBackPreview = useCallback(() => {
    setPanel((prev) => {
      if (prev.previewHistory.length === 0) return prev;
      const history = [...prev.previewHistory];
      let previousItem = history.pop()!;
      if (previousItem.kind === "task") {
        const fresh = prev.tasks.find((t) => t.task_id === previousItem.task.task_id);
        if (fresh) previousItem = { kind: "task", task: { ...previousItem.task, ...fresh } };
      }
      return { ...prev, previewItem: previousItem, previewHistory: history };
    });
  }, []);

  const closePreview = useCallback(() => {
    setPanel((prev) => ({ ...prev, previewItem: null, previewHistory: [] }));
  }, []);

  const toggleInfo = useCallback((_title: string, content: ReactNode) => {
    setPanel((prev) => {
      if (prev.showInfo) {
        return { ...prev, showInfo: false, infoContent: null };
      }
      return { ...prev, showInfo: true, infoContent: content };
    });
  }, []);

  const pushSpec = useCallback((spec: Spec) => {
    setPanel((prev) => {
      const exists = prev.specs.some((s) => s.spec_id === spec.spec_id);
      const next = exists
        ? prev.specs.map((s) => (s.spec_id === spec.spec_id ? spec : s))
        : [...prev.specs, spec];
      return { ...prev, specs: next.sort((a, b) => a.order_index - b.order_index) };
    });
  }, []);

  const removeSpec = useCallback((specId: string) => {
    setPanel((prev) => ({
      ...prev,
      specs: prev.specs.filter((s) => s.spec_id !== specId),
      deletedSpecIds: prev.deletedSpecIds.includes(specId)
        ? prev.deletedSpecIds
        : [...prev.deletedSpecIds, specId],
    }));
  }, []);

  const clearDeletedSpecs = useCallback(() => {
    setPanel((prev) => (prev.deletedSpecIds.length === 0 ? prev : { ...prev, deletedSpecIds: [] }));
  }, []);

  const pushTask = useCallback((task: Task) => {
    setPanel((prev) => {
      const exists = prev.tasks.some((t) => t.task_id === task.task_id);
      const next = exists
        ? prev.tasks.map((t) => (t.task_id === task.task_id ? task : t))
        : [...prev.tasks, task];
      let previewItem = prev.previewItem;
      if (previewItem?.kind === "task" && previewItem.task.task_id === task.task_id) {
        previewItem = { kind: "task", task };
      }
      const previewHistory = patchTaskInHistory(prev.previewHistory, task.task_id, task);
      return { ...prev, tasks: next.sort((a, b) => a.order_index - b.order_index), previewItem, previewHistory };
    });
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setPanel((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((t) => t.task_id !== taskId),
    }));
  }, []);

  const clearGeneratedArtifacts = useCallback(() => {
    setPanel((prev) => ({ ...prev, specs: [], tasks: [] }));
  }, []);

  const setStreamingAgentInstanceId = useCallback((id: string | null) => {
    setPanel((prev) => ({ ...prev, streamingAgentInstanceId: id }));
  }, []);

  const notifyAgentInstanceUpdate = useCallback((instance: AgentInstance) => {
    titleListeners.current.forEach((fn) => fn(instance));
  }, []);

  const onAgentInstanceUpdate = useCallback((listener: AgentInstanceUpdateListener) => {
    titleListeners.current.add(listener);
    return () => { titleListeners.current.delete(listener); };
  }, []);

  const patchTask = useCallback((taskId: string, patch: Partial<Task>) => {
    setPanel((prev) => {
      const found = prev.tasks.some((t) => t.task_id === taskId);
      if (!found) return prev;
      const tasks = prev.tasks.map((t) =>
        t.task_id === taskId ? { ...t, ...patch } : t,
      );
      return { ...prev, tasks };
    });
  }, []);

  const updatePreviewTask = useCallback((patch: Partial<Task> & { task_id: string }) => {
    setPanel((prev) => {
      let previewItem = prev.previewItem;
      if (previewItem?.kind === "task" && previewItem.task.task_id === patch.task_id) {
        previewItem = { kind: "task", task: { ...previewItem.task, ...patch } };
      }
      const previewHistory = patchTaskInHistory(prev.previewHistory, patch.task_id, patch);
      if (previewItem === prev.previewItem && previewHistory === prev.previewHistory) return prev;
      return { ...prev, previewItem, previewHistory };
    });
  }, []);

  const updatePreviewSpecs = useCallback((specs: Spec[]) => {
    setPanel((prev) => {
      if (prev.previewItem?.kind !== "specs_overview") return prev;
      return { ...prev, previewItem: { kind: "specs_overview", specs } };
    });
  }, []);

  return (
    <SidekickContext.Provider
      value={{
        ...panel,
        canGoBack: panel.previewHistory.length > 0,
        setActiveTab,
        viewSpec,
        viewTask,
        viewSession,
        pushPreview,
        goBackPreview,
        closePreview,
        toggleInfo,
        pushSpec,
        removeSpec,
        clearDeletedSpecs,
        pushTask,
        removeTask,
        patchTask,
        updatePreviewTask,
        updatePreviewSpecs,
        clearGeneratedArtifacts,
        setStreamingAgentInstanceId,
        notifyAgentInstanceUpdate,
        onAgentInstanceUpdate,
      }}
    >
      {children}
    </SidekickContext.Provider>
  );
}

export function useSidekick(): SidekickContextValue {
  const ctx = useContext(SidekickContext);
  if (!ctx) {
    throw new Error("useSidekick must be used within a SidekickProvider");
  }
  return ctx;
}
