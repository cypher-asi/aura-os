import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { clearLastProcessId, getLastProcessId } from "../../utils/storage";
import { useProcessStore } from "./stores/process-store";

export function ProcessIndexRedirect() {
  const processes = useProcessStore((s) => s.processes);
  const loading = useProcessStore((s) => s.loading);

  if (loading) {
    return <PageEmptyState icon={<Loader2 size={32} className="animate-spin" />} title="Loading processes..." />;
  }

  const lastId = getLastProcessId();
  const lastProcess = lastId ? processes.find((p) => p.process_id === lastId) : null;
  if (lastProcess) {
    return <Navigate to={`/process/${lastProcess.process_id}`} replace />;
  }

  if (lastId) {
    clearLastProcessId();
  }

  const target = processes[0];
  if (target) {
    return <Navigate to={`/process/${target.process_id}`} replace />;
  }

  return (
    <PageEmptyState
      icon={<Loader2 size={32} className="animate-spin" aria-hidden />}
      title="No processes yet"
      description="Create or connect a process to see it here."
    />
  );
}
