import { create } from "zustand";

export interface PendingQuickPrompt {
  id: number;
  agentId: string;
  text: string;
}

interface QuickPromptState {
  isOpen: boolean;
  preferredAgentId: string | null;
  pendingPrompt: PendingQuickPrompt | null;
  open: (preferredAgentId?: string | null) => void;
  close: () => void;
  queue: (agentId: string, text: string) => void;
  takeForAgent: (agentId: string) => string | null;
}

let nextPromptId = 1;

/**
 * App-wide handoff between the Quick Prompt palette and whichever chat lane
 * mounts after navigation. Prompts live only in memory: they never leak into
 * the URL, browser history, analytics, or persistent storage.
 */
export const useQuickPromptStore = create<QuickPromptState>((set, get) => ({
  isOpen: false,
  preferredAgentId: null,
  pendingPrompt: null,
  open: (preferredAgentId = null) =>
    set({
      isOpen: true,
      preferredAgentId: preferredAgentId ?? null,
      // A newly opened palette supersedes an abandoned handoff that never
      // reached its destination. Without this, a later matching chat mount
      // can unexpectedly resurrect an older prompt.
      pendingPrompt: null,
    }),
  close: () => set({ isOpen: false, preferredAgentId: null }),
  queue: (agentId, text) =>
    set({
      isOpen: false,
      preferredAgentId: null,
      pendingPrompt: { id: nextPromptId++, agentId, text },
    }),
  takeForAgent: (agentId) => {
    const pending = get().pendingPrompt;
    if (!pending || pending.agentId !== agentId) return null;
    set({ pendingPrompt: null });
    return pending.text;
  },
}));

/** Merge a Quick Prompt handoff without destroying text already drafted. */
export function mergeQuickPromptDraft(existing: string, incoming: string): string {
  const current = existing.trimEnd();
  return current ? `${current}\n\n${incoming}` : incoming;
}
