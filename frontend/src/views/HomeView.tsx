import { Navigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { getLastAgent } from "../utils/storage";

export function HomeView() {
  const lastAgent = getLastAgent();

  if (lastAgent) {
    return (
      <Navigate
        to={`/projects/${lastAgent.projectId}/agents/${lastAgent.agentInstanceId}`}
        replace
      />
    );
  }

  return (
    <PageEmptyState
      icon={<Rocket size={32} />}
      title="Welcome to AURA"
      description="Select a project from navigation or create a new one to get started."
    />
  );
}
