import { Brain } from "lucide-react";
import { AgentList } from "./AgentList";
import { AgentMainPanel } from "./AgentMainPanel";
import { AgentInfoPanel } from "./AgentInfoPanel";
import { useAgentStore, LAST_AGENT_ID_KEY } from "./stores";
import type { AuraApp } from "../types";

export const AgentsApp: AuraApp = {
  id: "agents",
  label: "Agents",
  icon: Brain,
  basePath: "/agents",
  LeftPanel: AgentList,
  MainPanel: AgentMainPanel,
  ResponsiveControls: AgentList,
  SidekickPanel: AgentInfoPanel,
  searchPlaceholder: "Search Agents...",
  onPrefetch: () => {
    const store = useAgentStore.getState();
    store.fetchAgents().catch(() => {});
    const lastId = localStorage.getItem(LAST_AGENT_ID_KEY);
    if (lastId) store.prefetchHistory(lastId);
  },
};
