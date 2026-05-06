import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Store } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { AgentTalentCard } from "../AgentTalentCard";
import { HireProjectPickerModal } from "../HireProjectPickerModal";
import { useFilteredMarketplaceAgents, useMarketplaceStore } from "../stores";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useDeferredModalOpen } from "../../../shared/hooks/use-deferred-modal-open";
import type { MarketplaceAgent } from "../marketplace-types";
import styles from "./MarketplaceMainPanel.module.css";

export function MarketplaceMainPanel() {
  const agents = useFilteredMarketplaceAgents();
  const setSelectedAgentId = useMarketplaceStore((s) => s.setSelectedAgentId);
  const refresh = useMarketplaceStore((s) => s.refresh);
  const loading = useMarketplaceStore((s) => s.loading);
  const error = useMarketplaceStore((s) => s.error);
  const navigate = useNavigate();
  const { agentId } = useParams();
  const [hireTarget, setHireTarget] = useState<MarketplaceAgent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Defer opening the hire modal until the projects list is hydrated so
  // the modal renders straight to the project list (no in-modal spinner)
  // and at its final size.
  const { isOpen: hireModalOpen, isPreparing: hirePreparing } =
    useDeferredModalOpen({
      requestedOpen: hireTarget !== null,
      prepare: () => useProjectsListStore.getState().refreshProjects(),
    });
  const preparingAgentId = hirePreparing ? hireTarget?.agent.agent_id ?? null : null;

  useEffect(() => {
    setSelectedAgentId(agentId ?? null);
  }, [agentId, setSelectedAgentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSelect = useCallback(
    (marketAgent: MarketplaceAgent) => {
      navigate(`/marketplace/${marketAgent.agent.agent_id}`);
    },
    [navigate],
  );

  return (
    <>
      <div className={styles.container}>
        <div ref={scrollRef} className={styles.scrollArea}>
          {agents.length === 0 ? (
            <div className={styles.emptyWrapper}>
              <EmptyState icon={<Store size={32} />}>
                {loading
                  ? "Loading marketplace…"
                  : error
                    ? `Failed to load marketplace: ${error}`
                    : "No hireable agents match this filter yet."}
              </EmptyState>
            </div>
          ) : (
            <div className={styles.grid}>
              {agents.map((marketAgent) => (
                <AgentTalentCard
                  key={marketAgent.agent.agent_id}
                  marketplaceAgent={marketAgent}
                  isSelected={marketAgent.agent.agent_id === agentId}
                  onSelect={() => handleSelect(marketAgent)}
                  onHire={() => setHireTarget(marketAgent)}
                  hirePreparing={preparingAgentId === marketAgent.agent.agent_id}
                />
              ))}
            </div>
          )}
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>

      <HireProjectPickerModal
        isOpen={hireModalOpen}
        agent={hireTarget?.agent ?? null}
        onClose={() => setHireTarget(null)}
        onHired={() => setHireTarget(null)}
      />
    </>
  );
}
