import { create } from "zustand";
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

export interface TerminalTarget {
  cwd?: string;
  remoteAgentId?: string;
  /** Optional project tag used for passive URL discovery. */
  projectId?: string;
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

function createTerminalInstance(): TerminalInstance {
  const num = nextNum++;
  return {
    id: `term-${Date.now()}-${num}`,
    title: `Terminal ${num}`,
    hook: null!,
  };
}

function targetChanged(
  state: Pick<TerminalPanelState, "cwd" | "remoteAgentId" | "projectId">,
  target: TerminalTarget,
): boolean {
  return (
    state.cwd !== target.cwd ||
    state.remoteAgentId !== target.remoteAgentId ||
    state.projectId !== target.projectId
  );
}

interface TerminalPanelState {
  terminals: TerminalInstance[];
  activeId: string | null;
  panelHeight: number;
  collapsed: boolean;
  contentReady: boolean;
  cwd?: string;
  /** When set, terminals connect to this remote agent's VM shell. */
  remoteAgentId?: string;
  /** Optional project tag that flows through to the backend for discovery. */
  projectId?: string;
  /** False until the owning panel has resolved whether this is local or remote. */
  modeReady: boolean;
  targetVersion: number;

  setTerminalTarget: (target: TerminalTarget) => void;
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

export const useTerminalPanelStore = create<TerminalPanelState>()((set, get) => ({
  terminals: [],
  activeId: null,
  panelHeight: saved.height,
  collapsed: true,
  contentReady: false,
  cwd: undefined,
  remoteAgentId: undefined,
  projectId: undefined,
  modeReady: false,
  targetVersion: 0,

  setTerminalTarget: (target) => {
    const state = get();
    const needsInitialTerminal = state.terminals.length === 0;
    if (!needsInitialTerminal && state.modeReady && !targetChanged(state, target)) {
      return;
    }
    const terminals = needsInitialTerminal ? [createTerminalInstance()] : state.terminals;
    set({
      cwd: target.cwd,
      remoteAgentId: target.remoteAgentId,
      projectId: target.projectId,
      modeReady: true,
      targetVersion: state.targetVersion + 1,
      terminals,
      activeId: state.activeId ?? terminals[0]?.id ?? null,
    });
  },

  setCwd: (cwd) => {
    const s = get();
    s.setTerminalTarget({
      cwd,
      remoteAgentId: s.remoteAgentId,
      projectId: s.projectId,
    });
  },

  setRemoteAgentId: (id) => {
    const s = get();
    s.setTerminalTarget({
      cwd: s.cwd,
      remoteAgentId: id,
      projectId: s.projectId,
    });
  },

  addTerminal: () => {
    const instance = createTerminalInstance();
    const key = instance.id;
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

