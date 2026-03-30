import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

const STORAGE_KEY = "aura-task-output-panel";
const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 500;

function loadPanelState(): { height: number; collapsed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { height: DEFAULT_HEIGHT, collapsed: false };
}

function savePanelState(height: number, collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, collapsed }));
  } catch { /* ignore */ }
}

interface TaskOutputPanelState {
  panelHeight: number;
  collapsed: boolean;
  activeTaskIds: Set<string>;
  activeTaskTitles: Map<string, string>;

  toggleCollapse: () => void;
  addTask: (taskId: string, title?: string) => void;
  removeTask: (taskId: string) => void;
  clearTasks: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

const saved = loadPanelState();

export const useTaskOutputPanelStore = create<TaskOutputPanelState>()((set, get) => ({
  panelHeight: saved.height,
  collapsed: saved.collapsed,
  activeTaskIds: new Set(),
  activeTaskTitles: new Map(),

  toggleCollapse: () => {
    set((s) => ({ collapsed: !s.collapsed }));
  },

  addTask: (taskId, title) => {
    set((s) => {
      const nextIds = new Set(s.activeTaskIds);
      nextIds.add(taskId);
      const nextTitles = new Map(s.activeTaskTitles);
      if (title) nextTitles.set(taskId, title);
      return { activeTaskIds: nextIds, activeTaskTitles: nextTitles };
    });
  },

  removeTask: (taskId) => {
    set((s) => {
      const nextIds = new Set(s.activeTaskIds);
      nextIds.delete(taskId);
      return { activeTaskIds: nextIds };
    });
  },

  clearTasks: () => {
    set({ activeTaskIds: new Set() });
  },

  handleMouseDown: (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = get().panelHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
      set({ panelHeight: newHeight });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  },
}));

useTaskOutputPanelStore.subscribe((s) => {
  savePanelState(s.panelHeight, s.collapsed);
});

export function useTaskOutputPanel() {
  return useTaskOutputPanelStore(useShallow((s) => s));
}
