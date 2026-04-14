import { create } from "zustand";

interface CreateAgentHandoff {
  target: string;
  label?: string;
}

interface ChatHandoffStore {
  pendingCreateAgentHandoff: CreateAgentHandoff | null;
  beginCreateAgentHandoff: (target: string, label?: string) => void;
  completeCreateAgentHandoff: (target: string) => void;
  clearCreateAgentHandoff: () => void;
}

export const useChatHandoffStore = create<ChatHandoffStore>()((set) => ({
  pendingCreateAgentHandoff: null,
  beginCreateAgentHandoff: (target, label) => {
    set({
      pendingCreateAgentHandoff: {
        target,
        label,
      },
    });
  },
  completeCreateAgentHandoff: (target) => {
    set((state) => (
      state.pendingCreateAgentHandoff?.target === target
        ? { pendingCreateAgentHandoff: null }
        : state
    ));
  },
  clearCreateAgentHandoff: () => {
    set({ pendingCreateAgentHandoff: null });
  },
}));
