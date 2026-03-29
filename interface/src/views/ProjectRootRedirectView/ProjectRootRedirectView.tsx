import { Navigate, useParams } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { projectAgentRoute } from "../../utils/mobileNavigation";
import { ProjectEmptyView } from "../ProjectEmptyView";

export function ProjectRootRedirectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { isMobileLayout } = useAuraCapabilities();

  if (isMobileLayout && projectId) {
    return <Navigate to={projectAgentRoute(projectId)} replace />;
  }

  return <ProjectEmptyView />;
}
