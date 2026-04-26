import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import type { LoopStatusResponse } from "../../shared/api/loop";
import { useEventStore } from "../../stores/event-store/index";
import { useChatUI } from "../../stores/chat-ui-store";
import { projectChatHistoryKey } from "../../stores/chat-history-store";
import { useTaskOutputPanelStore } from "../../stores/task-output-panel-store";
import { useLiveTaskIdsStore } from "../../stores/live-task-ids-store";
import { useAutomationLoopStore } from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";
import { EventType } from "../../shared/types/aura-events";

/**
 * Seed the Run panel store with "active" rows for any tasks the
 * server reports as currently streaming. Runs on boot + WS reconnect
 * so the panel doesn't silently drop rows whose `task_started` event
 * fired before the current session connected. Scoped to the project
 * we just fetched status for so we don't touch rows from other projects.
 */
function hydrateActiveTasksFromLoopStatus(
  res: LoopStatusResponse,
  projectId: ProjectId,
): void {
  const active = res.active_tasks ?? [];
  const panel = useTaskOutputPanelStore.getState();
  // Reconcile BEFORE promoting the new rows: any locally-"active" row
  // for this project whose task the server no longer reports as active
  // is a leftover from a stopped / refreshed prior run, and would
  // otherwise render its own cooking indicator alongside the new run's
  // row. Demote to "interrupted" as a transient holding state — the
  // subsequent `reconcilePanelStatuses` pass (driven by
  // `/projects/:pid/tasks`) upgrades it to `completed` / `failed` once
  // the authoritative per-task status loads.
  const keepIds = active.map((t) => t.task_id).filter(Boolean);
  panel.demoteStaleActive(projectId, keepIds);
  for (const entry of active) {
    if (!entry.task_id) continue;
    panel.hydrateActiveTask(entry.task_id, projectId, entry.agent_instance_id);
  }
}

/**
 * Seed every piece of "we're running" UI from the response body of
 * `/loop/start` (or `/loop/resume`) so the Run panel row and the Tasks
 * list "live" dot appear immediately — without waiting for the
 * corresponding `task_started` WebSocket event. The backend already
 * resolves the first or interrupted task id before responding, so this
 * closes the dead window that would otherwise leave the sidekick looking
 * idle on the very first task of a new run.
 */
function hydrateUiFromLoopStartResponse(
  res: LoopStatusResponse,
  projectId: ProjectId,
): void {
  hydrateActiveTasksFromLoopStatus(res, projectId);
  useLiveTaskIdsStore.getState().hydrateFromLoopStatus(res, projectId);
}

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
  // The URL's agentInstanceId is the *chat* surface the user is
  // currently viewing — keeping that around for the chat-ui-store
  // model selector. The loop runs on a separate `Loop`-role
  // instance; see `boundLoopId` below.
  const { agentInstanceId: chatAgentInstanceId } = useParams<{ agentInstanceId: string }>();
  const streamKey =
    projectId && chatAgentInstanceId
      ? projectChatHistoryKey(projectId, chatAgentInstanceId)
      : null;
  const { selectedModel } = useChatUI(streamKey ?? "__automation-status__");
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  // Bound `Loop`-role agent instance id for this project. Read by all
  // pause / resume / stop paths so the harness's "one in-flight turn
  // per agent_id" rule never collides with the active chat thread or
  // a parallel ad-hoc task run (each of which keeps its own
  // `agent_instance_id`).
  const boundLoopId = useAutomationLoopStore((s) => s.loopByProject[projectId] ?? null);
  const setBoundLoopId = useAutomationLoopStore((s) => s.setLoopAgent);

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
        // Rehydrate Run panel rows from authoritative server state
        // so the "No tasks" emptiness after refresh doesn't stay out
        // of sync with the spinning nav icon. Any missed
        // `task_started` events are effectively replayed here.
        hydrateUiFromLoopStartResponse(res, projectId);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchLoopStatus(); }, [fetchLoopStatus]);

  // Hydrate the bound Loop instance id from the project's agent
  // instances on mount. We run this independently of the loop status
  // fetch so the pause / stop buttons can target the right agent
  // even on the very first render after a refresh — before the user
  // has interacted with Start. Failure (offline, fresh project) is
  // non-fatal: the next `startLoop` response refreshes the binding.
  useEffect(() => {
    let cancelled = false;
    api.listAgentInstances(projectId)
      .then((instances) => {
        if (cancelled) return;
        const loop = instances.find((i) => i.instance_role === "loop");
        setBoundLoopId(projectId, loop?.agent_instance_id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, setBoundLoopId]);

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
        // The Loop-role row itself is persistent, so we keep
        // `boundLoopId` populated — the next Start reuses the same
        // instance. We only clear it when the row is deleted, which
        // happens via `LoopFinished` for terminal lifecycles.
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
        // Pause/resume always target the bound Loop instance so we
        // never accidentally resume an ephemeral executor or the
        // chat thread the user is currently viewing.
        const res = await api.resumeLoop(projectId, boundLoopId ?? undefined);
        if (res.active_agent_instances) setActiveAgents(res.active_agent_instances);
        setPaused(false);
        hydrateUiFromLoopStartResponse(res, projectId);
      } catch (err) {
        console.error("Failed to resume loop", err);
      }
      return;
    }
    // Flip both `starting` and `preparing` up-front so the Run button
    // spinner and the sidekick Run/Tasks tab loaders engage immediately
    // on click, and stay engaged without flicker across three phases:
    //   1. request in flight           -> starting=true,  preparing=true
    //   2. server accepted the start   -> starting=false, preparing=true
    //   3. first task_started arrives  -> preparing=false (via WS sub)
    // Without this the spinner would flash off between the HTTP
    // response and the `loop_started` WS event, making the ramp-up look
    // stalled on the first (or interrupted) task of a fresh run.
    setStarting(true);
    setPreparing(true);
    try {
      // Omit `agent_instance_id`: the backend resolves to the
      // project's `Loop`-role instance via
      // `ensure_default_loop_instance`, lazily creating one if this
      // is the first Start in the project. Passing the URL's
      // currently-viewed chat agent here would force the loop onto
      // that chat instance and the harness's "one in-flight turn per
      // agent_id" policy would silently abort either the chat reply
      // or the next loop turn — exactly the regression we're fixing.
      const res = await api.startLoop(projectId, undefined, selectedModel);
      if (res.active_agent_instances) setActiveAgents(res.active_agent_instances);
      // Capture the Loop instance the backend resolved to so all
      // subsequent pause / resume / stop calls scope themselves to
      // it. `start_loop` populates `agent_instance_id` on the
      // response with the resolved id, regardless of whether we
      // passed one in.
      if (res.agent_instance_id) {
        setBoundLoopId(projectId, res.agent_instance_id);
      }
      setPaused(false);
      setStarting(false);
      // Seed the Run panel row + Tasks list "live" dot from the response
      // so the user sees activity without waiting for task_started.
      hydrateUiFromLoopStartResponse(res, projectId);
    } catch (err) {
      setStarting(false); setPreparing(false);
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Failed to start loop", err);
    }
  }, [projectId, paused, selectedModel, boundLoopId, setBoundLoopId]);

  const handlePause = useCallback(async () => {
    try {
      await api.pauseLoop(projectId, boundLoopId ?? undefined);
      setPreparing(false);
    } catch (err) { console.error("Failed to pause loop", err); }
  }, [projectId, boundLoopId]);

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
      // Always scope Stop to the bound Loop instance. A
      // project-wide stop (boundLoopId === null) would also tear
      // down ephemeral task executors running concurrently in the
      // same project — the regression Phase 2's per-instance
      // registry was built to fix.
      const res = await api.stopLoop(projectId, boundLoopId ?? undefined);
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
  }, [projectId, boundLoopId, fetchLoopStatus]);

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
