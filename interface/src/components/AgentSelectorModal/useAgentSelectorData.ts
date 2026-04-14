import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import type { Agent, AgentInstance } from "../../types";
import { useProfileStatusStore } from "../../stores/profile-status-store";

interface AgentSelectorData {
  agents: Agent[];
  loading: boolean;
  creating: string | null;
  error: string;
  showEditor: boolean;
  setShowEditor: (v: boolean) => void;
  failedIcons: Set<string>;
  setFailedIcons: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleSelect: (agent: Agent) => Promise<void>;
  handleAgentSaved: (agent: Agent) => void;
  handleClose: () => void;
}

export function useAgentSelectorData(
  isOpen: boolean,
  projectId: string,
  onCreated: (instance: AgentInstance) => void,
  onClose: () => void,
): AgentSelectorData {
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);
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

  useEffect(() => {
    if (agents.length === 0) return;
    registerAgents(agents.map((a) => ({ id: a.agent_id, machineType: a.machine_type })));
    const remote = agents.filter((a) => a.machine_type === "remote" && a.network_agent_id);
    if (remote.length > 0) registerRemote(remote);
  }, [agents, registerAgents, registerRemote]);

  const handleSelect = useCallback(async (agent: Agent) => {
    setCreating(agent.agent_id);
    setError("");
    try {
      const instance = await api.createAgentInstance(projectId, agent.agent_id);
      onCreated(instance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent instance");
    } finally {
      setCreating(null);
    }
  }, [projectId, onCreated]);

  const handleAgentSaved = useCallback(async (agent: Agent) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.agent_id === agent.agent_id);
      if (idx >= 0) return prev.map((a) => (a.agent_id === agent.agent_id ? agent : a));
      return [...prev, agent];
    });
    setCreating(agent.agent_id);
    setError("");
    try {
      const instance = await api.createAgentInstance(projectId, agent.agent_id);
      onCreated(instance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Created the agent but could not add it to this project");
    } finally {
      setCreating(null);
    }
  }, [onCreated, projectId]);

  const handleClose = useCallback(() => {
    setError("");
    setCreating(null);
    setShowEditor(false);
    onClose();
  }, [onClose]);

  return {
    agents, loading, creating, error, showEditor, setShowEditor,
    failedIcons, setFailedIcons, handleSelect, handleAgentSaved, handleClose,
  };
}
