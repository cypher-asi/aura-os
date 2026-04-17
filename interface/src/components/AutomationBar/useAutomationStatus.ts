import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useEventStore } from "../../stores/event-store/index";
import { useChatUI } from "../../stores/chat-ui-store";
import { projectChatHistoryKey } from "../../stores/chat-history-store";
import type { ProjectId } from "../../types";
import { EventType } from "../../types/aura-events";

type AutomationStatus = "idle" | "starting" | "preparing" | "active" | "paused" | "stopped";

interface AutomationStatusData {
  status: AutomationStatus;
  agentCount: number;
  canPlay: boolean;
  canPause: boolean;
  canStop: boolean;
  starting: boolean;
  preparing: boolean;
  confirmStop: boolean;
  setConfirmStop: (v: boolean) => void;
  handleStart: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleStop: () => void;
  handleStopConfirm: () => Promise<void>;
  stopError: string | null;
  clearStopError: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}

export function useAutomationStatus(projectId: ProjectId): AutomationStatusData {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const streamKey =
    projectId && agentInstanceId ? projectChatHistoryKey(projectId, agentInstanceId) : null;
  const { selectedModel } = useChatUI(streamKey ?? "__automation-status__");
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const isForProject = useCallback(
    (event: { project_id?: string }) => event.project_id === projectId,
    [projectId],
  );

  const fetchLoopStatus = useCallback(() => {
    api.getLoopStatus(projectId)
      .then((res) => {
        if (res.active_agent_instances && res.active_agent_instances.length > 0) {
          setActiveAgents(res.active_agent_instances);
          setPaused(res.paused);
          setStarting(false);
        } else {
          setActiveAgents([]); setPaused(false); setStarting(false); setPreparing(false);
        }
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchLoopStatus(); }, [fetchLoopStatus]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) fetchLoopStatus();
    prevConnectedRef.current = connected;
  }, [connected, fetchLoopStatus]);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) setActiveAgents((prev) => prev.includes(agentId) ? prev : [...prev, agentId]);
        setPaused(false); setStarting(false); setPreparing(true);
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (!isForProject(e)) return; setPreparing(false);
      }),
      subscribe(EventType.LoopPaused, (e) => { if (!isForProject(e)) return; setPaused(true); setPreparing(false); }),
      subscribe(EventType.LoopResumed, (e) => { if (!isForProject(e)) return; setPaused(false); }),
      subscribe(EventType.LoopStopped, (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) setActiveAgents((prev) => prev.filter((id) => id !== agentId));
        else setActiveAgents([]);
        setPaused(false); setStarting(false); setPreparing(false);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_id;
        if (agentId) setActiveAgents((prev) => prev.filter((id) => id !== agentId));
        else setActiveAgents([]);
        setPaused(false); setStarting(false); setPreparing(false);
        if (e.content.outcome === "insufficient_credits") dispatchInsufficientCredits();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject]);

  const running = activeAgents.length > 0;

  let status: AutomationStatus = "idle";
  if (starting) status = "starting";
  else if (preparing) status = "preparing";
  else if (paused) status = "paused";
  else if (running) status = "active";

  const handleStart = useCallback(async () => {
    if (paused) {
      try {
        const res = await api.resumeLoop(projectId, agentInstanceId);
        if (res.active_agent_instances) setActiveAgents(res.active_agent_instances);
        setPaused(false);
      } catch (err) {
        console.error("Failed to resume loop", err);
      }
      return;
    }
    try {
      setStarting(true);
      const res = await api.startLoop(projectId, agentInstanceId, selectedModel);
      if (res.active_agent_instances) setActiveAgents(res.active_agent_instances);
      setPaused(false); setStarting(false);
    } catch (err) {
      setStarting(false); setPreparing(false);
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Failed to start loop", err);
    }
  }, [projectId, agentInstanceId, paused, selectedModel]);

  const handlePause = useCallback(async () => {
    try {
      await api.pauseLoop(projectId, agentInstanceId);
      setPreparing(false);
    } catch (err) { console.error("Failed to pause loop", err); }
  }, [projectId, agentInstanceId]);

  const handleStop = useCallback(() => {
    setStopError(null);
    setConfirmStop(true);
  }, []);

  const clearStopError = useCallback(() => setStopError(null), []);

  const handleStopConfirm = useCallback(async () => {
    setConfirmStop(false);
    setStopError(null);
    // Optimistically clear UI state so the Run button returns immediately even
    // if the HTTP round-trip is slow or ultimately fails. We reconcile against
    // the authoritative backend state below.
    setActiveAgents([]);
    setPaused(false);
    setStarting(false);
    setPreparing(false);
    try {
      const res = await api.stopLoop(projectId, agentInstanceId);
      setActiveAgents(res.active_agent_instances ?? []);
      setPaused(Boolean(res.paused));
      fetchLoopStatus();
    } catch (err) {
      console.error("Failed to stop loop", err);
      setStopError(errorMessage(err, "Failed to stop automation"));
      // If the stop request failed the harness may still be running; refresh
      // from the server so the UI reflects the true state instead of our
      // optimistic clear.
      fetchLoopStatus();
    }
  }, [projectId, agentInstanceId, fetchLoopStatus]);

  return {
    status, agentCount: activeAgents.length,
    canPlay: (!running && !paused && !starting) || paused,
    canPause: running && !paused,
    canStop: running || paused,
    starting, preparing, confirmStop, setConfirmStop,
    handleStart, handlePause, handleStop, handleStopConfirm,
    stopError, clearStopError,
  };
}
