import { useEffect } from "react";
import type { ProcessRun } from "../../../../shared/types";
import { EventType } from "../../../../shared/types/aura-events";
import { useEventStore } from "../../../../stores/event-store/index";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore, type NodeRunStatus } from "../../stores/process-sidekick-store";

/**
 * Subscribes to process run / node execution events for the active canvas process.
 * Keeps sidekick node status, live run highlight, runs list, and events in sync.
 */
export function useProcessMainPanelLiveEvents(processId: string | undefined) {
  const fetchEvents = useProcessStore((s) => s.fetchEvents);
  const setLastViewedRunId = useProcessStore((s) => s.setLastViewedRunId);
  const fetchRuns = useProcessStore((s) => s.fetchRuns);

  const setNodeStatus = useProcessSidekickStore((s) => s.setNodeStatus);
  const clearNodeStatuses = useProcessSidekickStore((s) => s.clearNodeStatuses);
  const setLiveRunNodeId = useProcessSidekickStore((s) => s.setLiveRunNodeId);
  const viewRun = useProcessSidekickStore((s) => s.viewRun);

  useEffect(() => {
    if (!processId) return;

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
            setLiveRunNodeId(c.node_id, c.run_id);
          } else {
            setLiveRunNodeId(null, c.run_id);
          }
        }
      }
    });

    const unsub2 = useEventStore.getState().subscribe(EventType.ProcessRunStarted, (event) => {
      if (event.content.process_id === processId) {
        clearNodeStatuses();
        fetchRuns(processId).then(() => {
          const runs = useProcessStore.getState().runs[processId];
          const startedRun = runs?.find((r: ProcessRun) => r.run_id === event.content.run_id);
          if (startedRun) {
            viewRun(startedRun);
            setLastViewedRunId(processId, startedRun.run_id);
          }
        });
      }
    });

    const handleRunFinished = (event: { content: { process_id: string; run_id: string } }) => {
      if (event.content.process_id === processId) {
        // Clear both node and run association — run is terminal, so
        // the persisted live-node pointer should no longer resurrect.
        setLiveRunNodeId(null, null);
        fetchRuns(processId);
        fetchEvents(processId, event.content.run_id);
      }
    };

    const unsub3 = useEventStore.getState().subscribe(EventType.ProcessRunCompleted, handleRunFinished);
    const unsub4 = useEventStore.getState().subscribe(EventType.ProcessRunFailed, handleRunFinished);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [processId, setNodeStatus, clearNodeStatuses, setLiveRunNodeId, fetchRuns, fetchEvents, setLastViewedRunId, viewRun]);
}
