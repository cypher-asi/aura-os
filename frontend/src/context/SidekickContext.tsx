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
  pushTask: (task: Task) => void;
  clearGeneratedArtifacts: () => void;
  setStreamingAgentInstanceId: (id: string | null) => void;
  notifyAgentInstanceUpdate: (instance: AgentInstance) => void;
  onAgentInstanceUpdate: (listener: AgentInstanceUpdateListener) => () => void;
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
  streamingAgentInstanceId: null,
};

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
      const previousItem = history.pop()!;
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
    }));
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
      return { ...prev, tasks: next.sort((a, b) => a.order_index - b.order_index), previewItem };
    });
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

  const updatePreviewTask = useCallback((patch: Partial<Task> & { task_id: string }) => {
    setPanel((prev) => {
      if (prev.previewItem?.kind !== "task") return prev;
      if (prev.previewItem.task.task_id !== patch.task_id) return prev;
      return {
        ...prev,
        previewItem: {
          kind: "task",
          task: { ...prev.previewItem.task, ...patch },
        },
      };
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
        pushTask,
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
