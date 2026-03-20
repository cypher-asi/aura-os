import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getLastAgent } from "../utils/storage";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { projectAgentChatRoute } from "../utils/mobileNavigation";
import { ProjectEmptyView } from "./ProjectEmptyView";

export function ProjectAgentRedirectView() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { agentsByProject, refreshProjectAgents } = useProjectsList();
  const [emptyProjectId, setEmptyProjectId] = useState<string | null>(null);

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
          setEmptyProjectId((current) => (current === projectId ? null : current));
          navigate(projectAgentChatRoute(projectId, matching.agent_instance_id), { replace: true });
          return;
        }
      }

      if (agents.length > 0) {
        setEmptyProjectId((current) => (current === projectId ? null : current));
        navigate(projectAgentChatRoute(projectId, agents[0].agent_instance_id), { replace: true });
        return;
      }

      setEmptyProjectId(projectId);
    };

    void resolveTarget();

    return () => {
      cancelled = true;
    };
  }, [agentsByProject, navigate, projectId, refreshProjectAgents]);

  if (projectId && emptyProjectId === projectId) {
    return <ProjectEmptyView mode="agent" />;
  }

  return null;
}
