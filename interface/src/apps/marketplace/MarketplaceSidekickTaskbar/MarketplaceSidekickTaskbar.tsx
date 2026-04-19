import { AgentSidekickTaskbar } from "../../agents/AgentSidekickTaskbar";
import { useMarketplaceAgentById, useMarketplaceStore } from "../stores";

/**
 * Taskbar variant for the Marketplace sidekick. Delegates to the Agents
 * app's taskbar with the currently previewed marketplace agent so ownership
 * checks (edit/delete actions) still go through the shared logic.
 */
export function MarketplaceSidekickTaskbar() {
  const selectedAgentId = useMarketplaceStore((s) => s.selectedAgentId);
  const marketplaceAgent = useMarketplaceAgentById(selectedAgentId);
  return <AgentSidekickTaskbar agent={marketplaceAgent?.agent ?? null} />;
}
