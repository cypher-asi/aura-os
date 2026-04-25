import { create } from "zustand";
import type { ProjectBrowserSettings } from "../shared/api/browser";

const MAX_INSTANCES = 4;

let nextNum = 1;

export interface BrowserInstance {
  /** Client-only id used before the server session id is known. */
  clientId: string;
  title: string;
  /** Server-issued session id (set after `spawnBrowser` resolves). */
  serverId: string | null;
}

interface BrowserPanelState {
  instances: BrowserInstance[];
  activeClientId: string | null;
  perProjectSettings: Record<string, ProjectBrowserSettings>;

  addInstance: () => BrowserInstance | null;
  removeInstance: (clientId: string) => void;
  setServerId: (clientId: string, serverId: string) => void;
  setActive: (clientId: string) => void;
  setInstanceTitle: (clientId: string, title: string) => void;
  setProjectSettings: (projectId: string, settings: ProjectBrowserSettings) => void;
  getProjectSettings: (projectId: string) => ProjectBrowserSettings | undefined;
  clear: () => void;
}

function createInstance(): BrowserInstance {
  const num = nextNum++;
  return {
    clientId: `browser-${Date.now()}-${num}`,
    title: `Browser ${num}`,
    serverId: null,
  };
}

export const useBrowserPanelStore = create<BrowserPanelState>()((set, get) => ({
  instances: [],
  activeClientId: null,
  perProjectSettings: {},

  addInstance: () => {
    if (get().instances.length >= MAX_INSTANCES) {
      return null;
    }
    const instance = createInstance();
    set((state) => ({
      instances: [...state.instances, instance],
      activeClientId: instance.clientId,
    }));
    return instance;
  },

  removeInstance: (clientId) => {
    set((state) => {
      const next = state.instances.filter((i) => i.clientId !== clientId);
      const nextActive =
        state.activeClientId === clientId
          ? (next[next.length - 1]?.clientId ?? null)
          : state.activeClientId;
      return { instances: next, activeClientId: nextActive };
    });
  },

  setServerId: (clientId, serverId) => {
    set((state) => ({
      instances: state.instances.map((i) =>
        i.clientId === clientId ? { ...i, serverId } : i,
      ),
    }));
  },

  setActive: (clientId) => set({ activeClientId: clientId }),

  setInstanceTitle: (clientId, title) => {
    set((state) => ({
      instances: state.instances.map((i) =>
        i.clientId === clientId ? { ...i, title } : i,
      ),
    }));
  },

  setProjectSettings: (projectId, settings) => {
    set((state) => ({
      perProjectSettings: { ...state.perProjectSettings, [projectId]: settings },
    }));
  },

  getProjectSettings: (projectId) => get().perProjectSettings[projectId],

  clear: () => {
    nextNum = 1;
    set({ instances: [], activeClientId: null, perProjectSettings: {} });
  },
}));
