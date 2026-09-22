import { create } from "zustand";
import type { ToolApprovalPrompt } from "../shared/types/harness-protocol";
import { registerPartitionRegistry } from "../hooks/stream/partition-registry";

interface ToolApprovalStore {
  prompts: Record<string, ToolApprovalPrompt | undefined>;
  setPrompt: (streamKey: string, prompt: ToolApprovalPrompt) => void;
  clearPrompt: (streamKey: string, requestId?: string) => void;
}

export const useToolApprovalStore = create<ToolApprovalStore>()((set) => ({
  prompts: {},
  setPrompt: (streamKey, prompt) =>
    set((state) => ({
      prompts: { ...state.prompts, [streamKey]: prompt },
    })),
  clearPrompt: (streamKey, requestId) =>
    set((state) => {
      const current = state.prompts[streamKey];
      if (!current || (requestId && current.request_id !== requestId)) return state;
      const prompts = { ...state.prompts };
      delete prompts[streamKey];
      return { prompts };
    }),
}));

registerPartitionRegistry({
  name: "tool-approval-prompts",
  migrate(oldKey, newKey) {
    const state = useToolApprovalStore.getState();
    const prompt = state.prompts[oldKey];
    if (!prompt) return;
    useToolApprovalStore.setState((current) => {
      const prompts = { ...current.prompts };
      if (!prompts[newKey]) prompts[newKey] = prompt;
      delete prompts[oldKey];
      return { prompts };
    });
  },
  clear(key) {
    useToolApprovalStore.getState().clearPrompt(key);
  },
});

export function setPendingToolApproval(streamKey: string, prompt: ToolApprovalPrompt): void {
  useToolApprovalStore.getState().setPrompt(streamKey, prompt);
}

export function clearPendingToolApproval(streamKey: string, requestId?: string): void {
  useToolApprovalStore.getState().clearPrompt(streamKey, requestId);
}
