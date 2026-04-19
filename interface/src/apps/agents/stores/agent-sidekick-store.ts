import { create } from "zustand";
import type { MemoryFact, MemoryEvent, MemoryProcedure, HarnessSkill, HarnessSkillInstallation } from "../../../types";
import { createSidekickSlice, type SidekickSliceState } from "../../../stores/shared/sidekick-slice";

export type AgentPreviewItem =
  | { kind: "skill"; skill: HarnessSkill; installation?: HarnessSkillInstallation }
  | { kind: "memory_fact"; fact: MemoryFact }
  | { kind: "memory_event"; event: MemoryEvent }
  | { kind: "memory_procedure"; procedure: MemoryProcedure };

export type AgentSidekickTab =
  | "profile"
  | "chats"
  | "skills"
  | "permissions"
  | "projects"
  | "tasks"
  | "processes"
  | "logs"
  | "stats"
  | "memory";

interface AgentSidekickState extends SidekickSliceState<AgentSidekickTab, AgentPreviewItem> {
  showEditor: boolean;
  showDeleteConfirm: boolean;

  requestEdit: () => void;
  requestDelete: () => void;
  closeEditor: () => void;
  closeDeleteConfirm: () => void;
  viewSkill: (skill: HarnessSkill, installation?: HarnessSkillInstallation) => void;
  viewMemoryFact: (fact: MemoryFact) => void;
  viewMemoryEvent: (event: MemoryEvent) => void;
  viewMemoryProcedure: (procedure: MemoryProcedure) => void;
  goBackPreview: () => void;
  closePreview: () => void;
}

export const useAgentSidekickStore = create<AgentSidekickState>()((set, get) => ({
  ...createSidekickSlice<AgentSidekickTab, AgentPreviewItem>("profile", set, get),
  showEditor: false,
  showDeleteConfirm: false,

  requestEdit: () => set({ showEditor: true }),
  requestDelete: () => set({ showDeleteConfirm: true }),
  closeEditor: () => set({ showEditor: false }),
  closeDeleteConfirm: () => set({ showDeleteConfirm: false }),
  viewSkill: (skill, installation) =>
    set({ previewItem: { kind: "skill", skill, installation }, previewHistory: [], canGoBack: false }),
  viewMemoryFact: (fact) =>
    set({ previewItem: { kind: "memory_fact", fact }, previewHistory: [], canGoBack: false }),
  viewMemoryEvent: (event) =>
    set({ previewItem: { kind: "memory_event", event }, previewHistory: [], canGoBack: false }),
  viewMemoryProcedure: (procedure) =>
    set({ previewItem: { kind: "memory_procedure", procedure }, previewHistory: [], canGoBack: false }),
  goBackPreview: () => get().popPreview(),
  closePreview: () => get().clearPreviews(),
}));
