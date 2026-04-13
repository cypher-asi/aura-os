import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

const STORAGE_KEY = "aura:desktopWindows";
const CASCADE_OFFSET = 28;
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 520;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const WINDOW_LAYER_HOST_SELECTOR = "[data-window-layer-host='true']";

export { MIN_WIDTH, MIN_HEIGHT };

export interface WindowState {
  agentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
}

export interface DesktopWindowState {
  windows: Record<string, WindowState>;
  nextZ: number;

  openWindow: (agentId: string) => void;
  closeWindow: (agentId: string) => void;
  minimizeWindow: (agentId: string) => void;
  maximizeWindow: (agentId: string) => void;
  restoreWindow: (agentId: string) => void;
  focusWindow: (agentId: string) => void;
  moveWindow: (agentId: string, x: number, y: number) => void;
  resizeWindow: (agentId: string, width: number, height: number) => void;
  setWindowRect: (agentId: string, x: number, y: number, width: number, height: number) => void;
  openOrFocus: (agentId: string) => void;
  isOpen: (agentId: string) => boolean;
}

function loadWindows(): Record<string, WindowState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, WindowState>;
  } catch {
    return {};
  }
}

function persistWindows(windows: Record<string, WindowState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
  } catch { /* ignore */ }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(windows: Record<string, WindowState>): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = null; persistWindows(windows); }, 300);
}


function computeMaxZ(windows: Record<string, WindowState>): number {
  let max = 0;
  for (const w of Object.values(windows)) {
    if (w.zIndex > max) max = w.zIndex;
  }
  return max;
}

function getWindowLayerHeight(): number | null {
  if (typeof document === "undefined") return null;
  const host = document.querySelector<HTMLElement>(WINDOW_LAYER_HOST_SELECTOR);
  if (!host) return null;
  const height = Math.round(host.getBoundingClientRect().height);
  return height > 0 ? height : null;
}

function cascadePosition(windows: Record<string, WindowState>): { x: number; y: number } {
  const count = Object.keys(windows).length;
  const hostHeight = getWindowLayerHeight();
  return {
    x: 60 + (count % 10) * CASCADE_OFFSET,
    y: hostHeight === null ? 40 : Math.max(0, hostHeight - DEFAULT_HEIGHT),
  };
}

export function selectWindowById(agentId: string) {
  return (state: DesktopWindowState): WindowState | undefined => state.windows[agentId];
}

export function selectIsWindowOpen(agentId: string) {
  return (state: DesktopWindowState): boolean => !!state.windows[agentId];
}

export function selectOrderedWindowIds(state: DesktopWindowState): string[] {
  return Object.values(state.windows)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((win) => win.agentId);
}

export function selectTopWindowId(state: DesktopWindowState): string | null {
  let topWindowId: string | null = null;
  let topZ = -Infinity;

  for (const win of Object.values(state.windows)) {
    if (win.zIndex > topZ) {
      topZ = win.zIndex;
      topWindowId = win.agentId;
    }
  }

  return topWindowId;
}

const initial = loadWindows();

export const useDesktopWindowStore = create<DesktopWindowState>()(
  subscribeWithSelector((set, get) => ({
    windows: initial,
    nextZ: computeMaxZ(initial) + 1,

    openWindow: (agentId) => {
      set((s) => {
        if (s.windows[agentId]) return s;
        const pos = cascadePosition(s.windows);
        const z = s.nextZ;
        const next: Record<string, WindowState> = {
          ...s.windows,
          [agentId]: {
            agentId,
            x: pos.x,
            y: pos.y,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            zIndex: z,
            minimized: false,
            maximized: false,
          },
        };
        persistWindows(next);
        return { windows: next, nextZ: z + 1 };
      });
    },

    closeWindow: (agentId) => {
      set((s) => {
        const { [agentId]: _, ...rest } = s.windows;
        persistWindows(rest);
        return { windows: rest };
      });
    },

    minimizeWindow: (agentId) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const next = { ...s.windows, [agentId]: { ...w, minimized: true } };
        persistWindows(next);
        return { windows: next };
      });
    },

    maximizeWindow: (agentId) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const z = s.nextZ;
        const next = {
          ...s.windows,
          [agentId]: { ...w, maximized: !w.maximized, minimized: false, zIndex: z },
        };
        persistWindows(next);
        return { windows: next, nextZ: z + 1 };
      });
    },

    restoreWindow: (agentId) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const z = s.nextZ;
        const next = {
          ...s.windows,
          [agentId]: { ...w, minimized: false, zIndex: z },
        };
        persistWindows(next);
        return { windows: next, nextZ: z + 1 };
      });
    },

    focusWindow: (agentId) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const z = s.nextZ;
        const next = { ...s.windows, [agentId]: { ...w, zIndex: z } };
        persistWindows(next);
        return { windows: next, nextZ: z + 1 };
      });
    },

    moveWindow: (agentId, x, y) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const next = { ...s.windows, [agentId]: { ...w, x, y } };
        schedulePersist(next);
        return { windows: next };
      });
    },

    resizeWindow: (agentId, width, height) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const clamped = {
          width: Math.max(MIN_WIDTH, width),
          height: Math.max(MIN_HEIGHT, height),
        };
        const next = { ...s.windows, [agentId]: { ...w, ...clamped } };
        schedulePersist(next);
        return { windows: next };
      });
    },

    setWindowRect: (agentId, x, y, width, height) => {
      set((s) => {
        const w = s.windows[agentId];
        if (!w) return s;
        const nextRect = {
          x,
          y: Math.max(0, y),
          width: Math.max(MIN_WIDTH, width),
          height: Math.max(MIN_HEIGHT, height),
        };
        if (
          w.x === nextRect.x &&
          w.y === nextRect.y &&
          w.width === nextRect.width &&
          w.height === nextRect.height
        ) {
          return s;
        }
        const next = { ...s.windows, [agentId]: { ...w, ...nextRect } };
        schedulePersist(next);
        return { windows: next };
      });
    },

    openOrFocus: (agentId) => {
      const { windows, openWindow, restoreWindow, focusWindow } = get();
      const w = windows[agentId];
      if (!w) {
        openWindow(agentId);
      } else if (w.minimized) {
        restoreWindow(agentId);
      } else {
        focusWindow(agentId);
      }
    },

    isOpen: (agentId) => {
      return !!get().windows[agentId];
    },
  })),
);
