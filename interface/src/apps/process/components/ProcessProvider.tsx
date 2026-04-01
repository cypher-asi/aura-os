import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useProcessStore } from "../stores/process-store";

export function ProcessProvider({ children }: { children: ReactNode }) {
  const fetchProcesses = useProcessStore((s) => s.fetchProcesses);
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const fetchConnections = useProcessStore((s) => s.fetchConnections);
  const fetchRuns = useProcessStore((s) => s.fetchRuns);
  const { processId } = useParams<{ processId: string }>();

  useEffect(() => { fetchProcesses(); }, [fetchProcesses]);

  useEffect(() => {
    if (processId) {
      fetchNodes(processId);
      fetchConnections(processId);
      fetchRuns(processId);
    }
  }, [processId, fetchNodes, fetchConnections, fetchRuns]);

  return <>{children}</>;
}
