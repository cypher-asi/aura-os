import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import {
  getApiErrorDetails,
  getApiErrorMessage,
} from "../../../shared/utils/api-errors";
import { useAgentStore } from "../stores";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import type { Agent } from "../../../shared/types";

export type AgentProjectBinding = {
  project_agent_id: string;
  project_id: string;
  project_name: string;
};

export type CascadeDeleteState = {
  bindings: AgentProjectBinding[];
  bindingsLoading: boolean;
  bindingsError: string | null;
  deleting: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  reset: () => void;
  /**
   * Remove every project binding for the agent and then delete the
   * template. Throws if any step fails so callers can keep their own
   * confirm modal open. On success, refreshes affected
   * `agentsByProject` entries plus the standalone agent list so every
   * surface drops the agent immediately.
   */
  deleteWithCascade: () => Promise<void>;
};

function formatDeleteError(err: unknown): string {
  const message = getApiErrorMessage(err);
  const details = getApiErrorDetails(err);
  return details ? `${message} ${details}` : message;
}

/**
 * Centralized "Delete agent template" workflow that takes care of the
 * server's "still added to projects" 409 by removing every binding the
 * caller knows about *before* issuing `DELETE /api/agents/:id`.
 *
 * Both [`AgentInfoPanel`](../AgentInfoPanel/AgentInfoPanel.tsx) and
 * [`AgentList`](../AgentList/AgentList.tsx) drive this hook so the
 * sidebar context-menu Delete behaves identically to the detail-panel
 * Delete instead of dead-ending on the 409 with no obvious
 * remediation.
 */
export function useCascadeDeleteAgent(agent: Agent | null): CascadeDeleteState {
  const [bindings, setBindings] = useState<AgentProjectBinding[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [bindingsError, setBindingsError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!agent) {
      setBindings([]);
      setBindingsError(null);
      setBindingsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setBindingsLoading(true);
    setBindingsError(null);
    try {
      const next = await api.agents.listProjectBindings(agent.agent_id);
      if (requestIdRef.current !== requestId) return;
      setBindings(next);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setBindings([]);
      setBindingsError(getApiErrorMessage(err));
    } finally {
      if (requestIdRef.current === requestId) {
        setBindingsLoading(false);
      }
    }
  }, [agent]);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setError(null);
    setBindingsError(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteWithCascade = useCallback(async () => {
    if (!agent) return;
    setDeleting(true);
    setError(null);
    try {
      // Snapshot the binding list so we can refresh exactly the
      // affected `agentsByProject` entries even if a refresh races
      // the cascade and clears local state mid-flight.
      const toRemove = bindings;
      const affectedProjectIds = new Set<string>();

      for (const binding of toRemove) {
        try {
          await api.agents.removeProjectBinding(
            agent.agent_id,
            binding.project_agent_id,
          );
          affectedProjectIds.add(binding.project_id);
        } catch (err) {
          // Re-fetch the binding list so the modal shows what is left
          // before the user retries.
          await refresh();
          throw new Error(
            `Could not remove agent from "${binding.project_name}": ${getApiErrorMessage(err)}`,
          );
        }
      }

      try {
        await api.agents.delete(agent.agent_id);
      } catch (err) {
        await refresh();
        throw new Error(formatDeleteError(err));
      }

      const projectsStore = useProjectsListStore.getState();
      await Promise.all(
        Array.from(affectedProjectIds).map((projectId) =>
          projectsStore.refreshProjectAgents(projectId).catch(() => undefined),
        ),
      );

      useAgentStore.getState().removeAgent(agent.agent_id);
      void useAgentStore.getState().fetchAgents({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setDeleting(false);
    }
  }, [agent, bindings, refresh]);

  return {
    bindings,
    bindingsLoading,
    bindingsError,
    deleting,
    error,
    refresh,
    reset,
    deleteWithCascade,
  };
}
