import { Button, PageEmptyState } from "@cypher-asi/zui";
import { FolderPlus, Rocket } from "lucide-react";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { useOrg } from "../context/OrgContext";

export function HomeView() {
  const { openNewProjectModal } = useProjectsList();
  const { activeOrg, isLoading } = useOrg();

  return (
    <PageEmptyState
      icon={<Rocket size={32} />}
      title="Welcome to AURA"
      description={
        activeOrg
          ? "Select a project from navigation or create a new one to get started."
          : isLoading
            ? "Loading your workspace..."
            : "Create or join a team to start your first project."
      }
      actions={(
        <Button
          icon={<FolderPlus size={16} />}
          onClick={openNewProjectModal}
          disabled={!activeOrg}
        >
          Create Project
        </Button>
      )}
    />
  );
}
