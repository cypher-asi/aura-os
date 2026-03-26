import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { UseTerminalReturn } from "../hooks/use-terminal";

const STORAGE_KEY = "aura-terminal-panel";
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const FIRST_EXPAND_DELAY_MS = 400;
const SUBSEQUENT_EXPAND_DELAY_MS = 80;

export interface TerminalInstance {
  id: string;
  title: string;
  hook: UseTerminalReturn;
}

function loadPanelState(): { height: number; collapsed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { height: DEFAULT_HEIGHT, collapsed: true };
}

function savePanelState(height: number, collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, collapsed }));
  } catch { /* ignore */ }
}

let nextNum = 1;
const hookRefs = new Map<string, UseTerminalReturn>();
let hasBeenExpandedOnce = false;
let contentReadyTimer: ReturnType<typeof setTimeout> | null = null;

interface TerminalPanelState {
  terminals: TerminalInstance[];
  activeId: string | null;
  panelHeight: number;
  collapsed: boolean;
  contentReady: boolean;
  cwd?: string;
  /** When set, terminals connect to this remote agent's VM shell. */
  remoteAgentId?: string;

  setCwd: (cwd: string | undefined) => void;
  setRemoteAgentId: (id: string | undefined) => void;
  addTerminal: () => void;
  removeTerminal: (id: string) => void;
  registerHook: (id: string, hook: UseTerminalReturn) => void;
  setActiveId: (id: string) => void;
  toggleCollapse: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

const saved = loadPanelState();
const firstKey = `term-${Date.now()}-${nextNum++}`;

export const useTerminalPanelStore = create<TerminalPanelState>()((set, get) => ({
  terminals: [{ id: firstKey, title: "Terminal 1", hook: null! }],
  activeId: firstKey,
  panelHeight: saved.height,
  collapsed: true,
  contentReady: false,
  cwd: undefined,
  remoteAgentId: undefined,

  setCwd: (cwd) => {
    set({ cwd });
  },

  setRemoteAgentId: (id) => {
    const prev = get().remoteAgentId;
    if (prev === id) return;
    // Kill every existing terminal so they respawn with the new target.
    for (const [tid, hook] of hookRefs) {
      hook.kill();
      hookRefs.delete(tid);
    }
    nextNum = 1;
    const firstId = `term-${Date.now()}-${nextNum++}`;
    set({
      remoteAgentId: id,
      terminals: [{ id: firstId, title: "Terminal 1", hook: null! }],
      activeId: firstId,
    });
  },

  addTerminal: () => {
    const num = nextNum++;
    const key = `term-${Date.now()}-${num}`;
    const instance: TerminalInstance = { id: key, title: `Terminal ${num}`, hook: null! };
    const { collapsed } = get();
    set((s) => ({
      terminals: [...s.terminals, instance],
      activeId: key,
      collapsed: false,
    }));
    if (collapsed) scheduleContentReady(set);
  },

  removeTerminal: (id) => {
    const hook = hookRefs.get(id);
    if (hook) {
      hook.kill();
      hookRefs.delete(id);
    }
    set((s) => {
      const next = s.terminals.filter((t) => t.id !== id);
      const newActiveId = s.activeId === id
        ? (next.length > 0 ? next[next.length - 1].id : null)
        : s.activeId;
      return { terminals: next, activeId: newActiveId };
    });
  },

  registerHook: (id, hook) => {
    hookRefs.set(id, hook);
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, hook } : t)),
    }));
  },

  setActiveId: (id) => {
    set({ activeId: id });
  },

  toggleCollapse: () => {
    const { collapsed } = get();
    const next = !collapsed;
    set({ collapsed: next });
    if (next) {
      if (contentReadyTimer) { clearTimeout(contentReadyTimer); contentReadyTimer = null; }
      requestAnimationFrame(() => set({ contentReady: false }));
    } else {
      scheduleContentReady(set);
    }
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

function scheduleContentReady(set: (partial: Partial<TerminalPanelState>) => void) {
  if (contentReadyTimer) clearTimeout(contentReadyTimer);
  const delay = hasBeenExpandedOnce ? SUBSEQUENT_EXPAND_DELAY_MS : FIRST_EXPAND_DELAY_MS;
  contentReadyTimer = setTimeout(() => {
    hasBeenExpandedOnce = true;
    contentReadyTimer = null;
    set({ contentReady: true });
  }, delay);
}

useTerminalPanelStore.subscribe((s) => {
  savePanelState(s.panelHeight, s.collapsed);
});

/**
 * Drop-in replacement for the old useTerminalPanel() context hook.
 */
export function useTerminalPanel() {
  return useTerminalPanelStore(useShallow((s) => s));
}
