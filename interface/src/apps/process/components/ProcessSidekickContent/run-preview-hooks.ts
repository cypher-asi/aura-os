/* eslint-disable react-hooks/set-state-in-effect -- run preview sync/fetch effects (same patterns as prior RunPreviewBody) */
import { useCallback, useEffect, useRef, useState } from "react";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useEventStore } from "../../../../stores/event-store/index";
import { EventType } from "../../../../types/aura-events";
import { processApi } from "../../../../api/process";
import type {
  ProcessArtifact,
  ProcessEvent,
  ProcessRun,
  ProcessRunTranscriptEvent,
} from "../../../../types";
import {
  EMPTY_NODES,
} from "./process-sidekick-utils";

export function mergeUsageField(
  prev: number | null | undefined,
  next: number | null | undefined,
): number | undefined {
  if (next == null) return prev ?? undefined;
  if (prev == null) return next ?? undefined;
  return Math.max(prev, next);
}

export function useRunPolling(initialRun: ProcessRun) {
  const [run, setRun] = useState(initialRun);
  const nodes = useProcessStore((s) => s.nodes[run.process_id]) ?? EMPTY_NODES;
  const connections = useProcessStore((s) => s.connections[run.process_id]) ?? [];
  const fetchRuns = useProcessStore((s) => s.fetchRuns);
  const setStoreEvents = useProcessStore((s) => s.setEvents);
  const connected = useEventStore((s) => s.connected);
  const cachedEvents = useProcessStore((s) => s.events[run.run_id]);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [events, setEvents] = useState<ProcessEvent[]>(cachedEvents ?? []);
  const [transcript, setTranscript] = useState<ProcessRunTranscriptEvent[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevConnectedRef = useRef(connected);

  const isActive = run.status === "running" || run.status === "pending";

  const loadData = useCallback(async () => {
    try {
      const [artList, evtList, transcriptList] = await Promise.all([
        processApi.listRunArtifacts(run.process_id, run.run_id),
        processApi.listRunEvents(run.process_id, run.run_id),
        processApi.listRunTranscript(run.process_id, run.run_id),
      ]);
      setArtifacts(artList);
      setEvents(evtList);
      setTranscript(
        [...(transcriptList ?? [])].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
      );
      setStoreEvents(run.run_id, evtList);
    } catch (e) {
      console.warn("[run-preview] loadData failed", e);
    }
  }, [run.process_id, run.run_id, setStoreEvents]);

  const refreshRun = useCallback(async () => {
    try {
      const updated = await processApi.getRun(run.process_id, run.run_id);
      setRun((prev) => ({
        ...updated,
        total_input_tokens: mergeUsageField(prev.total_input_tokens, updated.total_input_tokens),
        total_output_tokens: mergeUsageField(prev.total_output_tokens, updated.total_output_tokens),
        cost_usd: mergeUsageField(prev.cost_usd, updated.cost_usd),
      }));
      if (updated.status !== "running" && updated.status !== "pending") {
        fetchRuns(run.process_id);
      }
    } catch (e) {
      console.warn("[run-preview] refreshRun failed", e);
    }
  }, [run.process_id, run.run_id, fetchRuns]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (cachedEvents) {
      setEvents(cachedEvents);
    }
  }, [cachedEvents]);

  useEffect(() => {
    const applyRunUsage = (content: {
      process_id: string;
      run_id: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    }) => {
      if (content.process_id !== run.process_id || content.run_id !== run.run_id) return;
      setRun((prev) => ({
        ...prev,
        total_input_tokens: mergeUsageField(prev.total_input_tokens, content.total_input_tokens),
        total_output_tokens: mergeUsageField(prev.total_output_tokens, content.total_output_tokens),
        cost_usd: mergeUsageField(prev.cost_usd, content.cost_usd),
      }));
    };

    const unsubProgress = useEventStore.getState().subscribe(EventType.ProcessRunProgress, (event) => {
      applyRunUsage(event.content);
    });
    const unsubCompleted = useEventStore.getState().subscribe(EventType.ProcessRunCompleted, (event) => {
      applyRunUsage(event.content);
    });
    const unsubFailed = useEventStore.getState().subscribe(EventType.ProcessRunFailed, (event) => {
      applyRunUsage(event.content);
    });

    return () => {
      unsubProgress();
      unsubCompleted();
      unsubFailed();
    };
  }, [run.process_id, run.run_id]);

  useEffect(() => {
    if (!isActive) return;
    pollRef.current = setInterval(loadData, 2000);
    runPollRef.current = setInterval(refreshRun, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (runPollRef.current) clearInterval(runPollRef.current);
    };
  }, [isActive, loadData, refreshRun]);

  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      refreshRun();
      loadData();
    }
    prevConnectedRef.current = connected;
  }, [connected, loadData, refreshRun]);

  return { run, isActive, nodes, connections, artifacts, events, transcript, loadData, refreshRun };
}

export function useRunNodeTracking(
  runId: string,
  loadData: () => Promise<void>,
  refreshRun: () => Promise<void>,
) {
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      if (status === "running") initial.add(nodeId);
    }
    return initial;
  });

  useEffect(() => {
    const next = new Set<string>();
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      if (status === "running") next.add(nodeId);
    }
    setRunningNodeIds(next);
  }, [nodeStatuses]);

  useEffect(() => {
    const unsub1 = useEventStore.getState().subscribe(EventType.ProcessNodeExecuted, (event) => {
      if (event.content.run_id === runId) {
        const status = event.content.status.toLowerCase();
        if (status.includes("running")) {
          setRunningNodeIds((prev) => new Set(prev).add(event.content.node_id));
        } else {
          setRunningNodeIds((prev) => {
            const next = new Set(prev);
            next.delete(event.content.node_id);
            return next;
          });
        }
        loadData();
      }
    });
    const handleComplete = (event: { content: { run_id: string } }) => {
      if (event.content.run_id === runId) {
        setRunningNodeIds(new Set());
        refreshRun();
        loadData();
      }
    };
    const unsub2 = useEventStore.getState().subscribe(EventType.ProcessRunCompleted, handleComplete);
    const unsub3 = useEventStore.getState().subscribe(EventType.ProcessRunFailed, handleComplete);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [runId, loadData, refreshRun]);

  return runningNodeIds;
}
