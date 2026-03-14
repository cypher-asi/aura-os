import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";
import type { ChatSession, Sprint, Spec, Task } from "../types";

type SidekickTab = "sprint" | "specs" | "tasks" | "progress" | "log";

export type PreviewItem =
  | { kind: "sprint"; sprint: Sprint }
  | { kind: "spec"; spec: Spec }
  | { kind: "task"; task: Task };

interface PanelState {
  activeTab: SidekickTab;
  previewItem: PreviewItem | null;
  infoContent: ReactNode;
  showInfo: boolean;
  specs: Spec[];
  tasks: Task[];
  streamingSessionId: string | null;
}

type SessionUpdateListener = (session: ChatSession) => void;
type SprintUpdateListener = (sprint: Sprint) => void;

interface PanelActions {
  setActiveTab: (tab: SidekickTab) => void;
  viewSprint: (sprint: Sprint) => void;
  viewSpec: (spec: Spec) => void;
  viewTask: (task: Task) => void;
  closePreview: () => void;
  toggleInfo: (title: string, content: ReactNode) => void;
  pushSpec: (spec: Spec) => void;
  pushTask: (task: Task) => void;
  clearGeneratedArtifacts: () => void;
  setStreamingSessionId: (id: string | null) => void;
  notifySessionTitleUpdate: (session: ChatSession) => void;
  onSessionTitleUpdate: (listener: SessionUpdateListener) => () => void;
  updatePreviewTask: (patch: Partial<Task> & { task_id: string }) => void;
  updatePreviewSprint: (patch: Partial<Sprint> & { sprint_id: string }) => void;
  notifySprintUpdate: (sprint: Sprint) => void;
  onSprintUpdate: (listener: SprintUpdateListener) => () => void;
}

type SidekickContextValue = PanelState & PanelActions;

const INITIAL_PANEL: PanelState = {
  activeTab: "sprint",
  previewItem: null,
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
  const sprintListeners = useRef<Set<SprintUpdateListener>>(new Set());

  const setActiveTab = useCallback((tab: SidekickTab) => {
    setPanel((prev) => ({ ...prev, activeTab: tab, showInfo: false }));
  }, []);

  const viewSprint = useCallback((sprint: Sprint) => {
    setPanel((prev) => ({ ...prev, previewItem: { kind: "sprint", sprint } }));
  }, []);

  const viewSpec = useCallback((spec: Spec) => {
    setPanel((prev) => ({ ...prev, previewItem: { kind: "spec", spec } }));
  }, []);

  const viewTask = useCallback((task: Task) => {
    setPanel((prev) => ({ ...prev, previewItem: { kind: "task", task } }));
  }, []);

  const closePreview = useCallback(() => {
    setPanel((prev) => ({ ...prev, previewItem: null }));
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

  const updatePreviewSprint = useCallback((patch: Partial<Sprint> & { sprint_id: string }) => {
    setPanel((prev) => {
      if (prev.previewItem?.kind !== "sprint") return prev;
      if (prev.previewItem.sprint.sprint_id !== patch.sprint_id) return prev;
      return {
        ...prev,
        previewItem: {
          kind: "sprint",
          sprint: { ...prev.previewItem.sprint, ...patch },
        },
      };
    });
  }, []);

  const notifySprintUpdate = useCallback((sprint: Sprint) => {
    sprintListeners.current.forEach((fn) => fn(sprint));
  }, []);

  const onSprintUpdate = useCallback((listener: SprintUpdateListener) => {
    sprintListeners.current.add(listener);
    return () => { sprintListeners.current.delete(listener); };
  }, []);

  return (
    <SidekickContext.Provider
      value={{
        ...panel,
        setActiveTab,
        viewSprint,
        viewSpec,
        viewTask,
        closePreview,
        toggleInfo,
        pushSpec,
        pushTask,
        updatePreviewTask,
        clearGeneratedArtifacts,
        setStreamingSessionId,
        notifySessionTitleUpdate,
        onSessionTitleUpdate,
        updatePreviewSprint,
        notifySprintUpdate,
        onSprintUpdate,
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
