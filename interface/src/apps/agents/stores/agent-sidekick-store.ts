import { create } from "zustand";
import type { MemoryFact, MemoryEvent, MemoryProcedure, HarnessSkill } from "../../../types";

export type AgentPreviewItem =
  | { kind: "skill"; skill: HarnessSkill }
  | { kind: "memory_fact"; fact: MemoryFact }
  | { kind: "memory_event"; event: MemoryEvent }
  | { kind: "memory_procedure"; procedure: MemoryProcedure };

export type AgentSidekickTab =
  | "profile"
  | "chats"
  | "skills"
  | "projects"
  | "tasks"
  | "processes"
  | "logs"
  | "stats"
  | "memory";

interface AgentSidekickState {
  activeTab: AgentSidekickTab;
  showEditor: boolean;
  showDeleteConfirm: boolean;
  previewItem: AgentPreviewItem | null;
  previewHistory: AgentPreviewItem[];
  canGoBack: boolean;

  setActiveTab: (tab: AgentSidekickTab) => void;
  requestEdit: () => void;
  requestDelete: () => void;
  closeEditor: () => void;
  closeDeleteConfirm: () => void;
  viewSkill: (skill: HarnessSkill) => void;
  viewMemoryFact: (fact: MemoryFact) => void;
  viewMemoryEvent: (event: MemoryEvent) => void;
  viewMemoryProcedure: (procedure: MemoryProcedure) => void;
  pushPreview: (item: AgentPreviewItem) => void;
  goBackPreview: () => void;
  closePreview: () => void;
}

export const useAgentSidekickStore = create<AgentSidekickState>()((set, get) => ({
  activeTab: "profile",
  showEditor: false,
  showDeleteConfirm: false,
  previewItem: null,
  previewHistory: [],
  canGoBack: false,

  setActiveTab: (tab) => set({ activeTab: tab, previewItem: null, previewHistory: [], canGoBack: false }),
  requestEdit: () => set({ showEditor: true }),
  requestDelete: () => set({ showDeleteConfirm: true }),
  closeEditor: () => set({ showEditor: false }),
  closeDeleteConfirm: () => set({ showDeleteConfirm: false }),
  viewSkill: (skill) => set({ previewItem: { kind: "skill", skill }, previewHistory: [], canGoBack: false }),
  viewMemoryFact: (fact) => set({ previewItem: { kind: "memory_fact", fact }, previewHistory: [], canGoBack: false }),
  viewMemoryEvent: (event) => set({ previewItem: { kind: "memory_event", event }, previewHistory: [], canGoBack: false }),
  viewMemoryProcedure: (procedure) => set({ previewItem: { kind: "memory_procedure", procedure }, previewHistory: [], canGoBack: false }),
  pushPreview: (item) => {
    const { previewItem, previewHistory } = get();
    const newHistory = previewItem ? [...previewHistory, previewItem] : previewHistory;
    set({ previewHistory: newHistory, previewItem: item, canGoBack: newHistory.length > 0 });
  },
  goBackPreview: () => {
    const { previewHistory } = get();
    if (previewHistory.length === 0) return;
    const history = [...previewHistory];
    const popped = history.pop();
    if (!popped) return;
    set({ previewItem: popped, previewHistory: history, canGoBack: history.length > 0 });
  },
  closePreview: () => set({ previewItem: null, previewHistory: [], canGoBack: false }),
}));

