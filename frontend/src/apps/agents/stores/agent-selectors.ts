import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "./agent-store";
import type { Agent } from "../../../types";
import type { DisplaySessionEvent } from "../../../types/stream";

type FetchStatus = "idle" | "loading" | "ready" | "error";

const EMPTY_EVENTS: DisplaySessionEvent[] = [];
const IDLE_HISTORY = { events: EMPTY_EVENTS, status: "idle" as const, error: null };

type AgentsSlice = {
  agents: Agent[];
  status: FetchStatus;
  error: string | null;
  fetchAgents: () => Promise<void>;
};

export function useAgents(): AgentsSlice {
  return useAgentStore(
    useShallow((s) => ({
      agents: s.agents,
      status: s.agentsStatus,
      error: s.agentsError,
      fetchAgents: s.fetchAgents,
    })),
  );
}

type HistorySlice = {
  events: DisplaySessionEvent[];
  status: FetchStatus;
  error: string | null;
};

export function useAgentHistory(agentId: string | undefined): HistorySlice {
  return useAgentStore(
    useShallow((s) => {
      if (!agentId) return IDLE_HISTORY;
      const entry = s.history[agentId];
      return entry
        ? { events: entry.events, status: entry.status, error: entry.error }
        : IDLE_HISTORY;
    }),
  );
}

type SelectedAgentSlice = {
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  setSelectedAgent: (agentId: string | null) => void;
};

export function useSelectedAgent(): SelectedAgentSlice {
  return useAgentStore(
    useShallow((s) => ({
      selectedAgentId: s.selectedAgentId,
      selectedAgent:
        s.agents.find((a) => a.agent_id === s.selectedAgentId) ?? null,
      setSelectedAgent: s.setSelectedAgent,
    })),
  );
}

/** Agents sorted by most-recent updates. */
export function useSortedAgents(): Agent[] {
  const agents = useAgentStore((s) => s.agents);
  return useMemo(() => {
    return [...agents].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [agents]);
}
