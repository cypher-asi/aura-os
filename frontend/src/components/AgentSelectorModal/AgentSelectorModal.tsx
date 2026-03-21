import { Modal, Button, Spinner, Text } from "@cypher-asi/zui";
import { Bot } from "lucide-react";
import { EmptyState } from "../EmptyState";
import type { AgentInstance } from "../../types";
import { AgentEditorModal } from "../AgentEditorModal";
import { useAgentSelectorData } from "./useAgentSelectorData";
import styles from "./AgentSelectorModal.module.css";

interface AgentSelectorModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (instance: AgentInstance) => void;
}

export function AgentSelectorModal({ isOpen, projectId, onClose, onCreated }: AgentSelectorModalProps) {
  const {
    agents, loading, creating, error, showEditor, setShowEditor,
    failedIcons, setFailedIcons, handleSelect, handleAgentSaved, handleClose,
  } = useAgentSelectorData(isOpen, projectId, onCreated, onClose);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Add Agent to Project"
        size="md"
        footer={agents.length > 0 ? (
          <Button variant="ghost" onClick={() => setShowEditor(true)} disabled={!!creating}>
            + Create New Agent
          </Button>
        ) : undefined}
      >
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loadingWrap}>
              <Spinner size="sm" />
            </div>
          ) : agents.length === 0 ? (
            <div className={styles.emptyState}>
              <EmptyState>No agents yet. Create one to get started.</EmptyState>
              <div className={styles.emptyActions}>
                <Button variant="primary" onClick={() => setShowEditor(true)} disabled={!!creating}>
                  Create New Agent
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.grid}>
              {agents.map((agent) => (
                <button
                  key={agent.agent_id}
                  className={styles.card}
                  onClick={() => handleSelect(agent)}
                  disabled={!!creating}
                >
                  <div className={styles.cardIcon}>
                    {agent.icon && !failedIcons.has(agent.agent_id) ? (
                      <img
                        src={agent.icon}
                        alt=""
                        className={styles.cardIconImg}
                        onError={() => setFailedIcons((s) => new Set(s).add(agent.agent_id))}
                      />
                    ) : (
                      <Bot size={24} />
                    )}
                  </div>
                  <div className={styles.cardName}>{agent.name}</div>
                  {agent.role && <div className={styles.cardRole}>{agent.role}</div>}
                </button>
              ))}
            </div>
          )}
          {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
        </div>
      </Modal>

      <AgentEditorModal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        onSaved={handleAgentSaved}
      />
    </>
  );
}
