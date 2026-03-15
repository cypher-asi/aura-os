import { useState, useEffect, useCallback } from "react";
import { Modal, Button, Spinner, Text } from "@cypher-asi/zui";
import { Bot } from "lucide-react";
import { api } from "../api/client";
import type { Agent, AgentInstance } from "../types";
import { AgentEditorModal } from "./AgentEditorModal";
import styles from "./AgentSelectorModal.module.css";

interface AgentSelectorModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (instance: AgentInstance) => void;
}

export function AgentSelectorModal({ isOpen, projectId, onClose, onCreated }: AgentSelectorModalProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

  const fetchAgents = useCallback(() => {
    setLoading(true);
    setError("");
    api.agents
      .list()
      .then(setAgents)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load agents"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isOpen) fetchAgents();
  }, [isOpen, fetchAgents]);

  const handleSelect = async (agent: Agent) => {
    setCreating(agent.agent_id);
    setError("");
    try {
      const instance = await api.createAgentInstance(projectId, agent.agent_id);
      onCreated(instance);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent instance");
    } finally {
      setCreating(null);
    }
  };

  const handleAgentSaved = (agent: Agent) => {
    setShowEditor(false);
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.agent_id === agent.agent_id);
      if (idx >= 0) return prev.map((a) => (a.agent_id === agent.agent_id ? agent : a));
      return [...prev, agent];
    });
  };

  const handleClose = () => {
    setError("");
    setCreating(null);
    onClose();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Add Agent to Project"
        size="md"
        footer={
          <Button variant="ghost" onClick={() => setShowEditor(true)} disabled={!!creating}>
            + Create New Agent
          </Button>
        }
      >
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loadingWrap}>
              <Spinner size="sm" />
            </div>
          ) : agents.length === 0 ? (
            <div className={styles.emptyState}>
              <Text variant="muted" size="sm">No agents yet.</Text>
              <Text variant="muted" size="sm">Create one to get started.</Text>
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
