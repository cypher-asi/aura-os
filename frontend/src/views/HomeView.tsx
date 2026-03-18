import { Navigate } from "react-router-dom";
import { Rocket } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
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
    <EmptyState icon={<Rocket size={32} />}>
      Select a project from the sidebar or create a new one to get started.
    </EmptyState>
  );
}
