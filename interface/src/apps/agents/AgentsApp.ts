import { Brain } from "lucide-react";
import { AgentList } from "./AgentList";
import { AgentMainPanel } from "./AgentMainPanel";
import { AgentInfoPanel } from "./AgentInfoPanel";
import { AgentSidekickTaskbar } from "./AgentSidekickTaskbar";
import { useAgentStore, LAST_AGENT_ID_KEY } from "./stores";
import { api } from "../../api/client";
import { useChatHistoryStore, agentHistoryKey } from "../../stores/chat-history-store";
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
  SidekickTaskbar: AgentSidekickTaskbar,
  searchPlaceholder: "Search Agents...",
  onPrefetch: () => {
    useAgentStore.getState().fetchAgents().catch(() => {});
    const lastId = localStorage.getItem(LAST_AGENT_ID_KEY);
    if (lastId) {
      useChatHistoryStore.getState().prefetchHistory(
        agentHistoryKey(lastId),
        () => api.agents.listEvents(lastId),
      );
    }
  },
};
