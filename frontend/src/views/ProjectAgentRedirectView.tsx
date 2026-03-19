import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getLastAgent } from "../utils/storage";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { projectAgentChatRoute, projectWorkRoute } from "../utils/mobileNavigation";

export function ProjectAgentRedirectView() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { agentsByProject, refreshProjectAgents } = useProjectsList();

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const resolveTarget = async () => {
      const cachedAgents = agentsByProject[projectId];
      const agents = cachedAgents ?? await refreshProjectAgents(projectId);
      if (cancelled) return;

      const lastAgent = getLastAgent();
      if (lastAgent?.projectId === projectId) {
        const matching = agents.find((agent) => agent.agent_instance_id === lastAgent.agentInstanceId);
        if (matching) {
          navigate(projectAgentChatRoute(projectId, matching.agent_instance_id), { replace: true });
          return;
        }
      }

      if (agents.length > 0) {
        navigate(projectAgentChatRoute(projectId, agents[0].agent_instance_id), { replace: true });
        return;
      }

      navigate(projectWorkRoute(projectId), { replace: true });
    };

    void resolveTarget();

    return () => {
      cancelled = true;
    };
  }, [agentsByProject, navigate, projectId, refreshProjectAgents]);

  return null;
}
