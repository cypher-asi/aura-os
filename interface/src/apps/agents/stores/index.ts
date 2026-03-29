export { useAgentStore } from "./agent-store";
export { useAgents, useAgentHistory, useSelectedAgent, useSortedAgents } from "./agent-selectors";

export const LAST_AGENT_ID_KEY = "aura:lastAgentId";

export function getLastSelectedAgentId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(LAST_AGENT_ID_KEY);
}
