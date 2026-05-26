/**
 * Local store for agent avatar configurations.
 *
 * Maps agent IDs to their Anam avatar config (avatarId + voiceId).
 * Persisted to localStorage so avatars survive across sessions.
 * Future: migrate to aura-network agent record once the field exists.
 */

import { create } from "zustand";
import type { AnamAvatarConfig } from "../hooks/anam";

const STORAGE_KEY = "aura-agent-avatars";

interface AgentAvatarState {
  configs: Record<string, AnamAvatarConfig>;
  windowOpen: boolean;
  setAvatar: (agentId: string, config: AnamAvatarConfig | null) => void;
  getAvatar: (agentId: string) => AnamAvatarConfig | null;
  toggleWindow: () => void;
  closeWindow: () => void;
}

function loadPersistedConfigs(): Record<string, AnamAvatarConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, AnamAvatarConfig>;
  } catch {
    return {};
  }
}

function persistConfigs(configs: Record<string, AnamAvatarConfig>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // best effort
  }
}

export const useAgentAvatarStore = create<AgentAvatarState>((set, get) => ({
  configs: loadPersistedConfigs(),
  windowOpen: false,

  setAvatar: (agentId, config) => {
    set((state) => {
      const next = { ...state.configs };
      if (config) {
        next[agentId] = config;
      } else {
        delete next[agentId];
      }
      persistConfigs(next);
      return { configs: next };
    });
  },

  getAvatar: (agentId) => {
    return get().configs[agentId] ?? null;
  },

  toggleWindow: () => {
    set((state) => ({ windowOpen: !state.windowOpen }));
  },

  closeWindow: () => {
    set({ windowOpen: false });
  },
}));
