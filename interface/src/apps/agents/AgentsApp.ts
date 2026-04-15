import { createElement } from "react";
import { Brain } from "lucide-react";
import { AgentList } from "./AgentList";
import { AgentMainPanel } from "./AgentMainPanel";
import { AgentInfoPanel } from "./AgentInfoPanel";
import { AgentSidekickTaskbar } from "./AgentSidekickTaskbar";
import { useAgentStore } from "./stores";
import type { AuraApp } from "../types";

const AgentsLeftPanel = () => createElement(AgentList, { mode: "default" });
const AgentsResponsiveControls = () =>
  createElement(AgentList, { mode: "responsive-controls" });

export const AgentsApp: AuraApp = {
  id: "agents",
  label: "Agents",
  icon: Brain,
  basePath: "/agents",
  LeftPanel: AgentsLeftPanel,
  MainPanel: AgentMainPanel,
  ResponsiveControls: AgentsResponsiveControls,
  SidekickPanel: AgentInfoPanel,
  SidekickTaskbar: AgentSidekickTaskbar,
  searchPlaceholder: "Search",
  onPrefetch: () => {
    useAgentStore.getState().fetchAgents().catch(() => {});
  },
};
