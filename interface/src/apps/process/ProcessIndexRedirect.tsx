import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { useProcessStore, LAST_PROCESS_ID_KEY } from "./stores/process-store";

export function ProcessIndexRedirect() {
  const processes = useProcessStore((s) => s.processes);
  const loading = useProcessStore((s) => s.loading);

  if (loading) {
    return <PageEmptyState icon={<Loader2 size={32} className="animate-spin" />} title="Loading processes..." />;
  }

  const lastId = localStorage.getItem(LAST_PROCESS_ID_KEY);
  const lastProcess = lastId ? processes.find((p) => p.process_id === lastId) : null;
  if (lastProcess) {
    return <Navigate to={`/process/${lastProcess.process_id}`} replace />;
  }

  if (lastId) {
    localStorage.removeItem(LAST_PROCESS_ID_KEY);
  }

  const target = processes[0];
  if (target) {
    return <Navigate to={`/process/${target.process_id}`} replace />;
  }

  return null;
}
