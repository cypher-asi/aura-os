import { useEffect, useMemo } from "react";
import { Modal, Drawer, Button, Spinner, Text } from "@cypher-asi/zui";
import { EmptyState } from "../EmptyState";
import { Avatar } from "../Avatar";
import type { AgentInstance } from "../../shared/types";
import { AgentEditorModal } from "../AgentEditorModal";
import { useAvatarState } from "../../hooks/use-avatar-state";
import { useAgentSelectorData } from "./useAgentSelectorData";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import styles from "./AgentSelectorModal.module.css";

interface AgentSelectorModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (instance: AgentInstance) => void;
  isTransitioning?: boolean;
}

interface AgentCardProps {
  agent: {
    agent_id: string;
    icon: string | null;
    name: string;
    role: string;
  };
  disabled: boolean;
  onSelect: () => void;
}

function AgentCard({ agent, disabled, onSelect }: AgentCardProps) {
  const { status, isLocal } = useAvatarState(agent.agent_id);

  return (
    <button
      className={styles.card}
      onClick={onSelect}
      disabled={disabled}
    >
      <div className={styles.cardIcon}>
        <Avatar
          avatarUrl={agent.icon ?? undefined}
          name={agent.name}
          type="agent"
          size={48}
          status={status}
          isLocal={isLocal}
        />
      </div>
      <div className={styles.cardName}>{agent.name}</div>
      {agent.role && <div className={styles.cardRole}>{agent.role}</div>}
    </button>
  );
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
    agents, loading, creating, error, showEditor, setShowEditor,
    handleSelect, handleAgentSaved, handleClose,
  } = useAgentSelectorData(isOpen, projectId, onCreated, onClose);
  const assignedAgentIds = useMemo(
    () => new Set(assignedProjectAgents.map((agent) => agent.agent_id)),
    [assignedProjectAgents],
  );
  const visibleAgents = useMemo(
    () => {
      const pool = isMobileLayout ? agents.filter((agent) => agent.machine_type === "remote") : agents;
      return pool.filter((agent) => !assignedAgentIds.has(agent.agent_id));
    },
    [agents, assignedAgentIds, isMobileLayout],
  );
  const isBusy = Boolean(creating) || isTransitioning;
  useEffect(() => {
    if (!isMobileLayout || !isOpen || loading || showEditor) {
      return;
    }
    if (visibleAgents.length === 0) {
      setShowEditor(true);
    }
  }, [isMobileLayout, isOpen, loading, setShowEditor, showEditor, visibleAgents.length]);
  const handleOpenCreate = () => {
    setShowEditor(true);
  };
  const handleEditorClose = () => {
    setShowEditor(false);
    if (isMobileLayout && visibleAgents.length === 0 && !isBusy) {
      handleClose();
    }
  };
  const content = (
    <div className={styles.body}>
      {loading ? (
        <div className={styles.loadingWrap}>
          <Spinner size="sm" />
        </div>
      ) : visibleAgents.length === 0 ? (
        <div className={styles.emptyState}>
          <EmptyState>
            {isMobileLayout
              ? assignedProjectAgents.length > 0
                ? "No other remote agents are available for this project yet. Create one to keep the project focused."
                : "No remote agents yet. Create one to get started."
              : "No agents yet. Create one to get started."}
          </EmptyState>
          <div className={styles.emptyActions}>
            <Button variant="primary" onClick={handleOpenCreate} disabled={!!creating}>
              Create agent
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleAgents.map((agent) => (
            <AgentCard
              key={agent.agent_id}
              agent={agent}
              disabled={isBusy}
              onSelect={() => handleSelect(agent)}
            />
          ))}
        </div>
      )}
      {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
    </div>
  );

  return (
    <>
      {isMobileLayout ? (
        <Drawer
          side="bottom"
          isOpen={isOpen && !showEditor}
          onClose={() => { if (!isBusy) handleClose(); }}
          title="Add Remote Agent to Project"
          className={styles.mobileSheet}
          showMinimizedBar={false}
          defaultSize={520}
          maxSize={720}
        >
          <div className={styles.mobileSheetBody}>
            {content}
            <div className={styles.mobileFooter}>
              <Button variant="ghost" onClick={handleClose} disabled={isBusy}>
                Not now
              </Button>
              {visibleAgents.length > 0 ? (
                <Button variant="primary" onClick={handleOpenCreate} disabled={isBusy}>
                  Create agent
                </Button>
              ) : null}
            </div>
          </div>
        </Drawer>
      ) : (
        <Modal
          isOpen={isOpen && !showEditor}
          onClose={() => { if (!isBusy) handleClose(); }}
          title="Add Agent to Project"
          size="md"
          footer={visibleAgents.length > 0 ? (
            <Button variant="ghost" onClick={handleOpenCreate} disabled={isBusy}>
              + Create New Agent
            </Button>
          ) : undefined}
        >
          {content}
        </Modal>
      )}

      <AgentEditorModal
        isOpen={showEditor}
        onClose={handleEditorClose}
        onSaved={handleAgentSaved}
        closeOnSave={false}
        titleOverride={isMobileLayout ? "Create Remote Agent" : undefined}
        submitLabelOverride={isMobileLayout ? "Create agent" : undefined}
        closeLabelOverride={isMobileLayout ? (visibleAgents.length === 0 ? "Back to project" : "Back") : undefined}
      />
    </>
  );
}
