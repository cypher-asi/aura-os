/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { Agent } from "../../types";
import { api } from "../../api/client";

interface AgentAppContextValue {
  agents: Agent[];
  loading: boolean;
  selectedAgent: Agent | null;
  selectAgent: (agent: Agent | null) => void;
  refresh: () => void;
}

const AgentAppCtx = createContext<AgentAppContextValue | null>(null);

export function AgentAppProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    api.agents.list().then((list) => {
      setAgents(list.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(refresh);
    return () => window.cancelAnimationFrame(frame);
  }, [refresh]);

  const value = useMemo(
    () => ({ agents, loading, selectedAgent, selectAgent: setSelectedAgent, refresh }),
    [agents, loading, selectedAgent, refresh],
  );

  return <AgentAppCtx.Provider value={value}>{children}</AgentAppCtx.Provider>;
}

export function useAgentApp() {
  const ctx = useContext(AgentAppCtx);
  if (!ctx) throw new Error("useAgentApp must be used within AgentAppProvider");
  return ctx;
}
