import { useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Cpu } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { ResponsiveMainLane } from "../../../../components/ResponsiveMainLane";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore, type NodeRunStatus } from "../../stores/process-sidekick-store";
import { useEventStore } from "../../../../stores/event-store";
import { EventType } from "../../../../types/aura-events";
import { processApi } from "../../../../api/process";
import { ProcessCanvas } from "../ProcessCanvas";
import type { ReactNode } from "react";

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

  const setNodeStatus = useProcessSidekickStore((s) => s.setNodeStatus);
  const clearNodeStatuses = useProcessSidekickStore((s) => s.clearNodeStatuses);
  const setLiveRunNodeId = useProcessSidekickStore((s) => s.setLiveRunNodeId);

  const process = processes.find((p) => p.process_id === processId);
  const processNodes = useMemo(() => (processId ? nodes[processId] ?? EMPTY_NODES : EMPTY_NODES), [processId, nodes]);
  const processConnections = useMemo(() => (processId ? connections[processId] ?? EMPTY_CONNECTIONS : EMPTY_CONNECTIONS), [processId, connections]);

  useEffect(() => {
    const unsub1 = useEventStore.getState().subscribe(EventType.ProcessNodeExecuted, (event) => {
      const c = event.content;
      if (c.process_id === processId && c.node_id && c.status) {
        const status = c.status.toLowerCase();
        const mapped: NodeRunStatus | undefined =
          status.includes("running") ? "running"
          : status.includes("completed") ? "completed"
          : status.includes("failed") ? "failed"
          : status.includes("skipped") ? "skipped"
          : undefined;
        if (mapped) {
          setNodeStatus(c.node_id, mapped);
          if (mapped === "running") {
            setLiveRunNodeId(c.node_id);
          } else {
            setLiveRunNodeId(null);
          }
        }
      }
    });
    const unsub2 = useEventStore.getState().subscribe(EventType.ProcessRunStarted, (event) => {
      if (event.content.process_id === processId) clearNodeStatuses();
    });
    const unsub3 = useEventStore.getState().subscribe(EventType.ProcessRunCompleted, (event) => {
      if (event.content.process_id === processId && processId) {
        setLiveRunNodeId(null);
        fetchRuns(processId);
      }
    });
    const unsub4 = useEventStore.getState().subscribe(EventType.ProcessRunFailed, (event) => {
      if (event.content.process_id === processId && processId) {
        setLiveRunNodeId(null);
        fetchRuns(processId);
      }
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [processId, setNodeStatus, clearNodeStatuses, setLiveRunNodeId, fetchRuns]);

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

  const viewRun = useProcessSidekickStore((s) => s.viewRun);

  const handleTrigger = useCallback(async () => {
    if (!process) return;
    try {
      const run = await processApi.triggerProcess(process.process_id);
      fetchRuns(process.process_id);
      viewRun(run);
    } catch (e) {
      console.error("Failed to trigger process:", e);
    }
  }, [process, fetchRuns, viewRun]);

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
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <PageEmptyState
            icon={<Cpu size={32} />}
            title="Processes"
            description="Select a process or create one to get started."
          />
          {children}
        </div>
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
