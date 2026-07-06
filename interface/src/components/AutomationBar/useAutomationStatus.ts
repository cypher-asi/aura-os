import { useEffect, useReducer, useRef, useCallback, useState } from "react";
import {
  api,
  ApiClientError,
  isInsufficientCreditsError,
  dispatchInsufficientCredits,
} from "../../api/client";
import type {
  LoopEngineeringContract,
  LoopStatusResponse,
} from "../../shared/api/loop";
import { useEventStore } from "../../stores/event-store/index";
import { useLoopActivityStore } from "../../stores/loop-activity-store";
import { hydrateActiveTasksFromLoopStatus } from "../../stores/run-pane-sync";
import {
  useAutomationLoopStore,
  useAutomationModel,
} from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";
import { EventType } from "../../shared/types/aura-events";
import {
  agentsOf,
  automationReducer,
  canPause as canPauseFn,
  canPlay as canPlayFn,
  canStop as canStopFn,
  initialState,
  statusOf,
  type AutomationStatus,
} from "./automation-state-machine";

/**
 * Seed the Run panel store with "active" rows for any tasks the
 * server reports as currently streaming. Runs on boot + WS reconnect
 * so the panel doesn't silently drop rows whose `task_started` event
 * fired before the current session connected. Scoped to the project
 * we just fetched status for so we don't touch rows from other projects.
 */
/**
 * Seed the Run-panel row store from the response body of
 * `/loop/start` (or `/loop/resume`) so the panel appears immediately
 * -- without waiting for the corresponding `task_started` WebSocket
 * event. The Tasks-list per-row spinner is fed by the
 * `useLoopActivityStore`-derived `useLiveTaskIdsForProject` and does
 * not need a parallel start-response hydration: the backend's
 * `loop_opened` + `loop_activity_changed` WS events arrive within a
 * frame of the HTTP response and write `current_task_id` directly
 * onto the loop-activity store (now the single source of truth).
 */
function hydrateUiFromLoopStartResponse(
  res: LoopStatusResponse,
  projectId: ProjectId,
): void {
  hydrateActiveTasksFromLoopStatus(res, projectId);
}

/**
 * Project-scoped safety-net rehydrate of `loop-activity-store` after a
 * Start / Resume / Stop completes. The unified spinner (the
 * `LoopProgress` ring around the AutomationBar play button, per-task
 * row spinners, etc.) is normally driven by the
 * `loop_opened` / `loop_activity_changed` / `loop_ended` WS events,
 * but rapid Stop+Start cycles can race those events: the server may
 * have emitted `loop_started` (the legacy event the AutomationBar
 * listens to) and inserted a fresh `loop_registry` entry, but the
 * client hasn't received the matching `loop_opened` yet -- or worse,
 * inherited a stale activity row from a now-cancelled loop instance.
 *
 * Calling `hydrate({ project_id })` on every Start / Stop click
 * collapses the window to a single HTTP round-trip, so the spinner
 * snaps to authoritative server state without waiting on WS reconnect
 * or the per-client stall watchdog. Scoped to the project so
 * concurrent loops in other projects are untouched (matches the
 * `replaceSnapshot` merge-by-filter semantics in
 * [`loop-activity-store.ts`]).
 */
function rehydrateLoopActivityForProject(projectId: ProjectId): void {
  void useLoopActivityStore.getState().hydrate({ project_id: projectId });
}

/**
 * Surface for a failed `POST /loop/start` returned by
 * `useAutomationStatus`. The `code` lets the AutomationBar render a
 * different copy + a Reset affordance for the harness-wedge case
 * (`automation_already_running`) without parsing the free-text
 * `message` itself; the rest of `message` is the human-readable
 * sentence we got from the server.
 */
export interface StartLoopError {
  message: string;
  code: string | null;
  status: number | null;
  automatonId: string | null;
}

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
  handleStartLoopEngineering: (contract: LoopEngineeringContract) => Promise<void>;
  canStartLoopEngineering: boolean;
  handlePause: () => Promise<void>;
  handleStop: () => void;
  handleStopConfirm: () => Promise<void>;
  stopError: string | null;
  clearStopError: () => void;
  startError: StartLoopError | null;
  clearStartError: () => void;
  handleResetAndRetry: () => Promise<void>;
  loopEngineeringContract: LoopEngineeringContract | null;
}

interface AutomationStatusOptions {
  /**
   * Detached-loop reattach calls POST /loop/start as a side effect of
   * status polling. Only enable it from surfaces where the current
   * runtime can actually use the workspace; status-only web surfaces
   * must be able to observe local detached loops without starting
   * local-only work.
   */
  allowDetachedReattach?: boolean;
  /**
   * When set, detached reattach is allowed only for this exact
   * agent-instance id. Remote web workspaces use this to avoid
   * reattaching a stale local loop id returned by project-level
   * status polling.
   */
  detachedReattachAgentInstanceId?: string | null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}

/**
 * Classify a thrown error from `api.startLoop` / `api.resumeLoop` so
 * the AutomationBar can render a structured "Reset" affordance for the
 * `automation_already_running` 409 (the harness has a stale automaton
 * we cannot adopt) while still surfacing every other startup failure
 * with a visible modal instead of the previous silent
 * `console.error`. Without this, the per-task Play button and the
 * AutomationBar Play button both look like they did nothing after the
 * click, even though the server cleanly rejected the request.
 */
function describeStartLoopError(err: unknown): StartLoopError {
  if (err instanceof ApiClientError) {
    const data = (err.body as { data?: unknown }).data as
      | { automaton_id?: unknown }
      | null
      | undefined;
    const automatonId =
      typeof data?.automaton_id === "string" && data.automaton_id.length > 0
        ? data.automaton_id
        : null;
    return {
      message: err.body.error || err.message || "Failed to start automation",
      code: err.body.code || null,
      status: err.status,
      automatonId,
    };
  }
  return {
    message: errorMessage(err, "Failed to start automation"),
    code: null,
    status: null,
    automatonId: null,
  };
}

export function useAutomationStatus(
  projectId: ProjectId,
  startAgentInstanceId?: string | null,
  options: AutomationStatusOptions = {},
): AutomationStatusData {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  // Model the user picked in the AutomationBar's own picker. This is
  // deliberately independent of whichever chat thread is in the URL --
  // the loop's model is the loop's own per-project setting, not a
  // side effect of which chat tab happens to be visible. A `null`
  // here means "let the backend fall back to the bound Loop agent's
  // stored default_model".
  const { model: selectedModel } = useAutomationModel(projectId);

  // Single source of truth for the four previously-implicit-coupled
  // booleans (`activeAgents`, `paused`, `starting`, `preparing`).
  // Each WS subscription dispatches exactly one action; status,
  // agentCount, and the canPlay/canPause/canStop button gates are
  // pure derivations off this state. See `automation-state-machine.ts`
  // for the transition table.
  const [state, dispatch] = useReducer(automationReducer, initialState);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [startError, setStartError] = useState<StartLoopError | null>(null);
  const [loopEngineeringContract, setLoopEngineeringContract] =
    useState<LoopEngineeringContract | null>(null);

  // Bound `Loop`-role agent instance id for this project. Read by all
  // pause / resume / stop paths so the harness's "one in-flight turn
  // per agent_id" rule never collides with the active chat thread or
  // a parallel ad-hoc task run (each of which keeps its own
  // `agent_instance_id`).
  const boundLoopId = useAutomationLoopStore((s) => s.loopByProject[projectId] ?? null);
  const setBoundLoopId = useAutomationLoopStore((s) => s.setLoopAgent);
  const startTargetAgentInstanceId = startAgentInstanceId?.trim() || undefined;
  const allowDetachedReattach = options.allowDetachedReattach ?? true;
  const detachedReattachAgentInstanceId =
    options.detachedReattachAgentInstanceId?.trim() || undefined;

  const isForProject = useCallback(
    (event: { project_id?: string }) => event.project_id === projectId,
    [projectId],
  );

  // Loop-terminal / pause / resume events are emitted by EVERY
  // forwarder teardown (or pause/resume hop), including the ephemeral
  // task-runner automatons that `run_single_task` mints per task. They
  // all share the project_id, but the AutomationBar only cares about
  // the bound `Loop`-role instance — letting an ephemeral
  // `loop_finished` through would call `filterAgent` against the
  // bound id and (in the WS-blip case where the same id arrives) drop
  // the bar back to "idle" while the harness automaton keeps running.
  // When `boundLoopId` is not yet known (very first Start in a fresh
  // project) we still admit any project-matching event so the
  // `LoopStarted` handler can populate the binding from the WS frame
  // itself; once bound, every subsequent terminal event must match.
  const isForBoundLoop = useCallback(
    (event: { project_id?: string; agent_id?: string }) => {
      if (event.project_id !== projectId) return false;
      if (boundLoopId == null) return true;
      return event.agent_id === boundLoopId;
    },
    [projectId, boundLoopId],
  );

  // Project we already attempted a detached-loop reattach for, so a
  // failing `POST /loop/start` can't retrigger on every status fetch.
  const reattachAttemptedFor = useRef<string | null>(null);

  /**
   * The server reported `loop_state: "detached"`: a harness automaton
   * from a previous server process is still running, but the current
   * process has no registry entry or event forwarder for it (both are
   * in-memory and died with the restart). Re-adopt it through the
   * ordinary `POST /loop/start` conflict path — the backend hits the
   * harness 409, adopts the existing run, reattaches the WS stream,
   * and re-emits `loop_opened` so every live surface lights back up.
   */
  const reattachDetachedLoop = useCallback(
    (agentInstanceId: string) => {
      if (reattachAttemptedFor.current === projectId) return;
      reattachAttemptedFor.current = projectId;
      api.startLoop(projectId, agentInstanceId, selectedModel)
        .then((res) => {
          if (res.agent_instance_id) {
            setBoundLoopId(projectId, res.agent_instance_id);
          }
          dispatch({
            type: "statusFetched",
            agents: res.active_agent_instances ?? [],
            paused: Boolean(res.paused),
          });
          setLoopEngineeringContract(res.loop_engineering ?? null);
          hydrateUiFromLoopStartResponse(res, projectId);
          rehydrateLoopActivityForProject(projectId);
        })
        .catch((err) => {
          console.error("Failed to reattach detached dev loop", err);
        });
    },
    [projectId, selectedModel, setBoundLoopId],
  );

  const fetchLoopStatus = useCallback(() => {
    api.getLoopStatus(projectId)
      .then((res) => {
        dispatch({
          type: "statusFetched",
          agents: res.active_agent_instances ?? [],
          paused: Boolean(res.paused),
        });
        setLoopEngineeringContract(res.loop_engineering ?? null);
        // Rehydrate Run panel rows from authoritative server state
        // so the "No tasks" emptiness after refresh doesn't stay out
        // of sync with the spinning nav icon. Any missed
        // `task_started` events are effectively replayed here.
        hydrateUiFromLoopStartResponse(res, projectId);
        const detachedId =
          res.agent_instance_id ?? res.active_agent_instances?.[0] ?? null;
        const canReattachDetachedId =
          !detachedReattachAgentInstanceId ||
          detachedId === detachedReattachAgentInstanceId;
        if (
          allowDetachedReattach &&
          res.loop_state === "detached" &&
          detachedId &&
          canReattachDetachedId
        ) {
          reattachDetachedLoop(detachedId);
        }
      })
      .catch(() => {});
  }, [
    allowDetachedReattach,
    detachedReattachAgentInstanceId,
    projectId,
    reattachDetachedLoop,
  ]);

  useEffect(() => { fetchLoopStatus(); }, [fetchLoopStatus]);

  // Hydrate the bound Loop instance id from the project's agent
  // instances on mount. We run this independently of the loop status
  // fetch so the pause / stop buttons can target the right agent
  // even on the very first render after a refresh -- before the user
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
        // `loop_started` is how the bar *discovers* the bound Loop
        // instance on a fresh project (the listAgentInstances hydrate
        // on mount may have raced this WS frame). Cache the binding
        // here so the subsequent terminal-event filter has a real id
        // to match against on the very first run.
        if (e.agent_id && boundLoopId == null) {
          setBoundLoopId(projectId, e.agent_id);
        }
        dispatch({ type: "loopStarted", agentId: e.agent_id });
      }),
      subscribe(EventType.TaskStarted, (e) => {
        // Project-only filter intentionally: `task_started` for an
        // ephemeral task runner carries the runner's `agent_id`, not
        // the bound Loop's, and the bar legitimately uses any project
        // task start to promote preparing → active.
        if (!isForProject(e)) return;
        dispatch({ type: "taskStarted" });
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (!isForBoundLoop(e)) return;
        dispatch({ type: "loopPaused" });
      }),
      subscribe(EventType.LoopResumed, (e) => {
        if (!isForBoundLoop(e)) return;
        dispatch({ type: "loopResumed" });
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (!isForBoundLoop(e)) return;
        dispatch({ type: "loopStopped", agentId: e.agent_id });
        // The Loop-role row itself is persistent, so we keep
        // `boundLoopId` populated -- the next Start reuses the same
        // instance. We only clear it when the row is deleted, which
        // happens via `LoopFinished` for terminal lifecycles.
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (!isForBoundLoop(e)) return;
        dispatch({ type: "loopFinished", agentId: e.agent_id });
        // Side effect kept verbatim outside the reducer: the
        // insufficient-credits dispatch fans out to the global error
        // banner, which is React-state work the pure reducer must
        // not own.
        if (e.content.outcome === "insufficient_credits") dispatchInsufficientCredits();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject, isForBoundLoop, projectId, boundLoopId, setBoundLoopId]);

  const status = statusOf(state);
  const agentCount = agentsOf(state).length;

  const beginFreshLoop = useCallback(
    async (start: () => Promise<LoopStatusResponse>) => {
      setStartError(null);
      // Optimistically flip into `starting` so the Run button spinner
      // and the sidekick Run/Tasks tab loaders engage immediately on
      // click, and stay engaged without flicker across three phases:
      //   1. request in flight           -> kind: "starting"
      //   2. loop_started WS arrives     -> kind: "preparing"
      //   3. task_started WS arrives     -> kind: "active"
      dispatch({ type: "startClicked" });
      setLoopEngineeringContract(null);
      try {
        const res = await start();
        if (res.agent_instance_id) {
          setBoundLoopId(projectId, res.agent_instance_id);
        }
        dispatch({
          type: "statusFetched",
          agents: res.active_agent_instances ?? [],
          paused: false,
        });
        setLoopEngineeringContract(res.loop_engineering ?? null);
        hydrateUiFromLoopStartResponse(res, projectId);
        rehydrateLoopActivityForProject(projectId);
        if (
          (res.active_agent_instances ?? []).length > 0 &&
          (res.active_tasks ?? []).length === 0
        ) {
          window.setTimeout(() => fetchLoopStatus(), 500);
        }
      } catch (err) {
        dispatch({ type: "startFailed" });
        if (isInsufficientCreditsError(err)) {
          dispatchInsufficientCredits();
        } else {
          setStartError(describeStartLoopError(err));
        }
        console.error("Failed to start loop", err);
      }
    },
    [fetchLoopStatus, projectId, setBoundLoopId],
  );

  const handleStart = useCallback(async () => {
    setStartError(null);
    if (state.kind === "paused") {
      try {
        // Pause/resume always target the bound Loop instance so we
        // never accidentally resume an ephemeral executor or the
        // chat thread the user is currently viewing.
        const res = await api.resumeLoop(projectId, boundLoopId ?? undefined);
        dispatch({
          type: "statusFetched",
          agents: res.active_agent_instances ?? [],
          paused: false,
        });
        setLoopEngineeringContract(res.loop_engineering ?? null);
        hydrateUiFromLoopStartResponse(res, projectId);
        rehydrateLoopActivityForProject(projectId);
      } catch (err) {
        console.error("Failed to resume loop", err);
        setStartError(describeStartLoopError(err));
      }
      return;
    }
    await beginFreshLoop(() =>
      api.startLoop(projectId, startTargetAgentInstanceId, selectedModel)
    );
  }, [
    beginFreshLoop,
    projectId,
    state.kind,
    selectedModel,
    boundLoopId,
    startTargetAgentInstanceId,
  ]);

  const canStartLoopEngineering =
    status === "idle" || status === "stopped";

  const handleStartLoopEngineering = useCallback(
    async (contract: LoopEngineeringContract) => {
      if (!canStartLoopEngineering) return;
      await beginFreshLoop(() =>
        api.startLoopEngineering(
          projectId,
          { loopEngineering: contract },
          startTargetAgentInstanceId,
          selectedModel,
        ),
      );
    },
    [
      beginFreshLoop,
      canStartLoopEngineering,
      projectId,
      selectedModel,
      startTargetAgentInstanceId,
    ],
  );

  const handlePause = useCallback(async () => {
    try {
      // The server emits `loop_paused` on success; the WS handler
      // dispatches `loopPaused` to drive the UI. We deliberately do
      // NOT optimistically dispatch here: a no-op-on-failure path
      // keeps the bar in `active` if the harness rejects the pause,
      // matching the old code's behaviour (it only cleared
      // `preparing`, never set `paused`).
      await api.pauseLoop(projectId, boundLoopId ?? undefined);
    } catch (err) { console.error("Failed to pause loop", err); }
  }, [projectId, boundLoopId]);

  const handleStop = useCallback(() => {
    setStopError(null);
    setConfirmStop(true);
  }, []);

  const clearStopError = useCallback(() => setStopError(null), []);
  const clearStartError = useCallback(() => setStartError(null), []);

  /**
   * "Reset and retry" path for the `automation_already_running` modal.
   * Calls `stopLoop` against the bound Loop instance to evict any
   * local registry slot (and forward the stop to the harness if the
   * automaton id is known server-side), then re-invokes `handleStart`
   * once so the user does not have to click Play a second time. Errors
   * are funnelled back into the same `startError` modal so the user
   * always sees the outcome.
   */
  const handleResetAndRetry = useCallback(async () => {
    setStartError(null);
    try {
      await api.stopLoop(projectId, boundLoopId ?? undefined);
    } catch (err) {
      // Stop is best-effort here — the wedge may mean the local
      // registry is empty, in which case `stopLoop` is a no-op and
      // we still want to attempt the start. Surface the error only if
      // the subsequent start also fails (handled below).
      console.warn("Reset: stopLoop failed (continuing to retry start)", err);
    }
    fetchLoopStatus();
    rehydrateLoopActivityForProject(projectId);
    await handleStart();
  }, [projectId, boundLoopId, fetchLoopStatus, handleStart]);

  const handleStopConfirm = useCallback(async () => {
    setConfirmStop(false);
    setStopError(null);
    // Optimistically clear UI state so the Run button returns immediately even
    // if the HTTP round-trip is slow or ultimately fails. We reconcile against
    // the authoritative backend state below.
    dispatch({ type: "stopRequested" });
    try {
      // Always scope Stop to the bound Loop instance. A
      // project-wide stop (boundLoopId === null) would also tear
      // down ephemeral task executors running concurrently in the
      // same project -- the regression Phase 2's per-instance
      // registry was built to fix.
      const res = await api.stopLoop(projectId, boundLoopId ?? undefined);
      dispatch({
        type: "statusFetched",
        agents: res.active_agent_instances ?? [],
        paused: Boolean(res.paused),
      });
      setLoopEngineeringContract(res.loop_engineering ?? null);
      fetchLoopStatus();
      // Also rehydrate the unified spinner store so any stale activity
      // row from the loop instance we just stopped is evicted on the
      // same round-trip as the legacy status fetch, instead of waiting
      // for the `loop_ended` WS event to land (which may race a rapid
      // follow-up Start).
      rehydrateLoopActivityForProject(projectId);
    } catch (err) {
      console.error("Failed to stop loop", err);
      setStopError(errorMessage(err, "Failed to stop automation"));
      // If the stop request failed the harness may still be running; refresh
      // from the server so the UI reflects the true state instead of our
      // optimistic clear.
      fetchLoopStatus();
      rehydrateLoopActivityForProject(projectId);
    }
  }, [projectId, boundLoopId, fetchLoopStatus]);

  return {
    status,
    agentCount,
    canPlay: canPlayFn(state),
    canPause: canPauseFn(state),
    canStop: canStopFn(state),
    // Legacy boolean projections retained for callers that haven't
    // migrated to `status` yet (none currently rely on them, but the
    // interface surface stays compatible).
    starting: state.kind === "starting",
    preparing: state.kind === "preparing",
    confirmStop, setConfirmStop,
    handleStart, handleStartLoopEngineering, canStartLoopEngineering,
    handlePause, handleStop, handleStopConfirm,
    stopError, clearStopError,
    startError, clearStartError, handleResetAndRetry,
    loopEngineeringContract,
  };
}
