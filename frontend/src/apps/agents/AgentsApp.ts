import { Brain } from "lucide-react";
import { AgentList } from "./AgentList";
import { AgentMainPanel } from "./AgentMainPanel";
import { useAgentStore } from "./stores";
import type { AuraApp } from "../types";

export const AgentsApp: AuraApp = {
  id: "agents",
  label: "Agents",
  icon: Brain,
  basePath: "/agents",
  LeftPanel: AgentList,
  MainPanel: AgentMainPanel,
  ResponsiveControls: AgentList,
  searchPlaceholder: "Search Agents...",
  onPrefetch: () => {
    useAgentStore.getState().fetchAgents().catch(() => {});
  },
};
