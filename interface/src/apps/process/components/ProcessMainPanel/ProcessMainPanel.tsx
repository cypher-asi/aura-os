import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { ResponsiveMainLane } from "../../../../components/ResponsiveMainLane";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { processApi } from "../../../../shared/api/process";
import { ProcessCanvas } from "../ProcessCanvas";
import type { ReactNode } from "react";
import { useProcessMainPanelLiveEvents } from "./useProcessMainPanelLiveEvents";

const EMPTY_NODES: never[] = [];
const EMPTY_CONNECTIONS: never[] = [];

export function ProcessMainPanel({ children }: { children?: ReactNode }) {
  const { processId } = useParams<{ processId: string }>();
  const processes = useProcessStore((s) => s.processes);
  const nodes = useProcessStore((s) => s.nodes);
  const connections = useProcessStore((s) => s.connections);
  const runs = useProcessStore((s) => s.runs);
  const updateProcess = useProcessStore((s) => s.updateProcess);
  const fetchRuns = useProcessStore((s) => s.fetchRuns);
  const setLastViewedRunId = useProcessStore((s) => s.setLastViewedRunId);
  const viewRun = useProcessSidekickStore((s) => s.viewRun);

  useProcessMainPanelLiveEvents(processId);

  const process = processes.find((p) => p.process_id === processId);
  const processNodes = useMemo(() => (processId ? nodes[processId] ?? EMPTY_NODES : EMPTY_NODES), [processId, nodes]);
  const processConnections = useMemo(() => (processId ? connections[processId] ?? EMPTY_CONNECTIONS : EMPTY_CONNECTIONS), [processId, connections]);

  const handleToggle = useCallback(async () => {
    if (!process) return;
    try {
      const updated = await processApi.updateProcess(process.process_id, {
        enabled: !process.enabled,
      });
      updateProcess(updated);
    } catch (e) {
      console.error("Failed to toggle process:", e);
    }
  }, [process, updateProcess]);

  const handleTrigger = useCallback(async () => {
    if (!process) return;
    try {
      const run = await processApi.triggerProcess(process.process_id);
      fetchRuns(process.process_id);
      viewRun(run);
      setLastViewedRunId(process.process_id, run.run_id);
    } catch (e) {
      console.error("Failed to trigger process:", e);
    }
  }, [process, fetchRuns, viewRun, setLastViewedRunId]);

  const handleStop = useCallback(async () => {
    if (!process || !processId) return;
    const processRuns = runs[processId] ?? [];
    const activeRun = processRuns.find((r) => r.status === "running" || r.status === "pending");
    if (!activeRun) return;
    try {
      await processApi.cancelRun(process.process_id, activeRun.run_id);
      fetchRuns(process.process_id);
    } catch (e) {
      console.error("Failed to stop process run:", e);
    }
  }, [process, processId, runs, fetchRuns]);

  if (!processId || !process) {
    return (
      <ResponsiveMainLane>
        <div style={{ height: "100%" }}>{children}</div>
      </ResponsiveMainLane>
    );
  }

  return (
    <ResponsiveMainLane>
      <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
        <ProcessCanvas
          processId={processId}
          processNodes={processNodes}
          processConnections={processConnections}
          onTrigger={handleTrigger}
          onToggle={handleToggle}
          onStop={handleStop}
          isEnabled={process.enabled}
        />
        {children}
      </div>
    </ResponsiveMainLane>
  );
}
