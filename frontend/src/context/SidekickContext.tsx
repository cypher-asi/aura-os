import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";
import type { ChatSession, Spec, Task, Session } from "../types";

export type SidekickTab = "specs" | "tasks" | "progress" | "sessions" | "log";

export type PreviewItem =
  | { kind: "spec"; spec: Spec }
  | { kind: "specs_overview"; specs: Spec[] }
  | { kind: "task"; task: Task }
  | { kind: "session"; session: Session };

interface PanelState {
  activeTab: SidekickTab;
  previewItem: PreviewItem | null;
  previewHistory: PreviewItem[];
  infoContent: ReactNode;
  showInfo: boolean;
  specs: Spec[];
  tasks: Task[];
  streamingSessionId: string | null;
}

type SessionUpdateListener = (session: ChatSession) => void;

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
  setStreamingSessionId: (id: string | null) => void;
  notifySessionTitleUpdate: (session: ChatSession) => void;
  onSessionTitleUpdate: (listener: SessionUpdateListener) => () => void;
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
  streamingSessionId: null,
};

const SidekickContext = createContext<SidekickContextValue | null>(null);

export function SidekickProvider({ children }: { children: React.ReactNode }) {
  const [panel, setPanel] = useState<PanelState>(INITIAL_PANEL);
  const titleListeners = useRef<Set<SessionUpdateListener>>(new Set());

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

  const setStreamingSessionId = useCallback((id: string | null) => {
    setPanel((prev) => ({ ...prev, streamingSessionId: id }));
  }, []);

  const notifySessionTitleUpdate = useCallback((session: ChatSession) => {
    titleListeners.current.forEach((fn) => fn(session));
  }, []);

  const onSessionTitleUpdate = useCallback((listener: SessionUpdateListener) => {
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
        setStreamingSessionId,
        notifySessionTitleUpdate,
        onSessionTitleUpdate,
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
