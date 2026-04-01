import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type AgentSidekickTab =
  | "profile"
  | "chats"
  | "skills"
  | "projects"
  | "tasks"
  | "crons"
  | "logs"
  | "stats";

interface AgentSidekickState {
  activeTab: AgentSidekickTab;
  showEditor: boolean;
  showDeleteConfirm: boolean;

  setActiveTab: (tab: AgentSidekickTab) => void;
  requestEdit: () => void;
  requestDelete: () => void;
  closeEditor: () => void;
  closeDeleteConfirm: () => void;
}

export const useAgentSidekickStore = create<AgentSidekickState>()((set) => ({
  activeTab: "profile",
  showEditor: false,
  showDeleteConfirm: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  requestEdit: () => set({ showEditor: true }),
  requestDelete: () => set({ showDeleteConfirm: true }),
  closeEditor: () => set({ showEditor: false }),
  closeDeleteConfirm: () => set({ showDeleteConfirm: false }),
}));

export function useAgentSidekick() {
  return useAgentSidekickStore(useShallow((s) => s));
}
