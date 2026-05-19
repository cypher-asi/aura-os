import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer, Modal, Spinner, Text } from "@cypher-asi/zui";
import type { AgentInstance } from "../../../../shared/types";
import { AgentSelectorList } from "./AgentSelectorList";
import { useAgentSelectorData } from "./useAgentSelectorData";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import styles from "./AgentSelectorModal.module.css";

interface AgentSelectorModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (instance: AgentInstance) => void;
  isTransitioning?: boolean;
}

export function AgentSelectorModal({
  isOpen,
  projectId,
  onClose,
  onCreated,
  isTransitioning = false,
}: AgentSelectorModalProps) {
  const { isMobileLayout } = useAuraCapabilities();
  const agentsByProject = useProjectsListStore((state) => state.agentsByProject);
  const assignedProjectAgents = agentsByProject[projectId] ?? [];
  const {
    agents,
    loading,
    creating,
    error,
    handleSelect,
    handleSelectStandard,
    handleClose,
  } = useAgentSelectorData(isOpen, projectId, onCreated, onClose);

  const assignedAgentIds = useMemo(
    () => new Set(assignedProjectAgents.map((agent) => agent.agent_id)),
    [assignedProjectAgents],
  );

  // The picker hides agents that are already attached to the project so
  // every fleet row in the list is a real, additive choice. The mobile
  // layout further restricts to remote agents — local agents need a
  // local launcher present and are not addable from the phone shell.
  const visibleAgents = useMemo(() => {
    const pool = isMobileLayout
      ? agents.filter((agent) => agent.machine_type === "remote")
      : agents;
    return pool.filter((agent) => !assignedAgentIds.has(agent.agent_id));
  }, [agents, assignedAgentIds, isMobileLayout]);

  const isBusy = Boolean(creating) || isTransitioning;
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset the search every time the modal closes so the next open
  // starts from a clean slate. Without this, the previous query would
  // persist across project rows and quietly hide the Standard row.
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  const list = (
    <AgentSelectorList
      ref={searchInputRef}
      agents={visibleAgents}
      query={query}
      onQueryChange={setQuery}
      onSelectStandard={handleSelectStandard}
      onSelectAgent={handleSelect}
      creating={creating}
      loading={loading}
      error={error}
      onCancel={() => {
        if (!isBusy) handleClose();
      }}
    />
  );

  return (
    <>
      {isMobileLayout ? (
        <Drawer
          side="bottom"
          isOpen={isOpen}
          onClose={handleClose}
          title="Add agent"
          className={styles.mobileSheet}
          showMinimizedBar={false}
          defaultSize={520}
          maxSize={720}
        >
          <div className={styles.mobileSheetBody}>{list}</div>
        </Drawer>
      ) : (
        <Modal
          isOpen={isOpen}
          onClose={handleClose}
          title="Select an agent"
          size="sm"
          initialFocusRef={searchInputRef as React.RefObject<HTMLElement>}
        >
          {list}
        </Modal>
      )}

      {isTransitioning && (
        <div className={styles.transitionOverlay}>
          <Spinner size="md" />
          <Text size="sm" variant="muted">
            Opening chat...
          </Text>
        </div>
      )}
    </>
  );
}
