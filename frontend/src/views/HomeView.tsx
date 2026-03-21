import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useOrgStore } from "../stores/org-store";

export function HomeView() {
  const { activeOrg, isLoading } = useOrgStore(
    useShallow((s) => ({ activeOrg: s.activeOrg, isLoading: s.isLoading })),
  );

  return (
    <PageEmptyState
      icon={<Rocket size={32} />}
      title="Welcome to AURA"
      description={
        activeOrg
          ? "Select a project from navigation to get started."
          : isLoading
            ? "Loading your workspace..."
            : "Create or join a team to start your first project."
      }
    />
  );
}
