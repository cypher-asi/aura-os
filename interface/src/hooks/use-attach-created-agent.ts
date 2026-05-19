import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { queryClient } from "../shared/lib/query-client";
import {
  mergeAgentIntoProjectAgents,
  projectQueryKeys,
} from "../queries/project-queries";
import { useChatHandoffStore } from "../stores/chat-handoff-store";
import { useProjectsList } from "../apps/projects/useProjectsList";
import {
  createAgentChatHandoffState,
  projectAgentHandoffTarget,
} from "../utils/chat-handoff";
import type { AgentInstance } from "../shared/types";

/**
 * Shared "agent instance just got created, route the user into its chat"
 * step used by both the agent picker (`useProjectListActions.handleAgentCreated`)
 * and the new-project flow (`AppShell.ProjectCreationModalHost`).
 *
 * Keeps cache writes, the `chat-handoff-store` arming, and the navigation
 * with `createAgentChatHandoffState()` in one place so the two surfaces
 * can't drift. Intentionally does NOT touch the agent-selector modal's
 * own `pendingCreatedAgent` / `agentSelectorProjectId` state — that's
 * owned by `useProjectListActions` and only relevant when the picker
 * actually opened the agent.
 */
export function useAttachCreatedAgent() {
  const navigate = useNavigate();
  const { setAgentsByProject, refreshProjectAgents } = useProjectsList();
  const beginCreateAgentHandoff = useChatHandoffStore(
    (state) => state.beginCreateAgentHandoff,
  );

  return useCallback(
    (instance: AgentInstance) => {
      const pid = instance.project_id;
      setAgentsByProject((prev) => ({
        ...prev,
        [pid]: mergeAgentIntoProjectAgents(prev[pid], instance),
      }));
      queryClient.setQueryData(
        projectQueryKeys.agentInstance(pid, instance.agent_instance_id),
        instance,
      );
      beginCreateAgentHandoff(
        projectAgentHandoffTarget(pid, instance.agent_instance_id),
        instance.name,
      );
      navigate(`/projects/${pid}/agents/${instance.agent_instance_id}`, {
        state: createAgentChatHandoffState(),
      });
      void refreshProjectAgents(pid);
    },
    [beginCreateAgentHandoff, navigate, refreshProjectAgents, setAgentsByProject],
  );
}
