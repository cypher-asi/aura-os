import { useParams } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { SquareKanban } from "lucide-react";

export function TasksMainPanel({ children }: { children?: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return (
      <PageEmptyState
        icon={<SquareKanban size={32} />}
        title="Tasks"
        description="Select a project from navigation to view its task board."
      />
    );
  }

  return <>{children}</>;
}
