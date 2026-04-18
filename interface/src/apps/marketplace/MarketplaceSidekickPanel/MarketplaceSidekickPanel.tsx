import { EmptyState } from "../../../components/EmptyState";
import { AgentInfoPanel } from "../../agents/AgentInfoPanel";
import { useMarketplaceAgentById, useMarketplaceStore } from "../stores";

/**
 * Sidekick for the Marketplace. Reuses the Agents app's `AgentInfoPanel` so
 * non-owned agents are rendered with the same tabs (Profile / Skills /
 * Memory / …) but read-only. The marketplace store's `selectedAgentId` is
 * kept in sync with the `/marketplace/:agentId` route in
 * `MarketplaceMainPanel`, so this component just needs to resolve it.
 */
export function MarketplaceSidekickPanel() {
  const selectedAgentId = useMarketplaceStore((s) => s.selectedAgentId);
  const marketplaceAgent = useMarketplaceAgentById(selectedAgentId);

  if (!marketplaceAgent) {
    return <EmptyState>Pick a talent card to preview the agent.</EmptyState>;
  }

  return <AgentInfoPanel agent={marketplaceAgent.agent} />;
}
