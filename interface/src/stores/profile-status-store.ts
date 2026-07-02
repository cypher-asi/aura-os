import { create } from "zustand";
import { api } from "../api/client";
import { ApiClientError } from "../shared/api/core";
import { useEventStore } from "./event-store";
import { useAuthStore } from "./auth-store";
import { useSidekickStore } from "./sidekick-store";
import { EventType } from "../shared/types/aura-events";

const REMOTE_POLL_MS = 30_000;

type MachineType = "local" | "remote";

interface ProfileStatusState {
  statuses: Record<string, string>;
  machineTypes: Record<string, MachineType>;
  init: () => void;
  registerAgents: (agents: { id: string; machineType: string }[]) => void;
  registerRemoteAgents: (agents: { agent_id: string }[]) => void;
}

let _initialized = false;
const _polledAgentIds = new Set<string>();
let _pollInterval: ReturnType<typeof setInterval> | undefined;
const _remoteAgentIds = new Set<string>();

/** Agent IDs with at least one active task (interface-tracked). */
const _activeTaskAgents = new Set<string>();

function normalizeMachineType(mt: string | undefined): MachineType {
  return mt === "remote" ? "remote" : "local";
}

function setStatus(id: string, status: string) {
  useProfileStatusStore.setState((s) => {
    if (s.statuses[id] === status) return s;
    return { statuses: { ...s.statuses, [id]: status } };
  });
}

function setStatuses(updates: Record<string, string>) {
  useProfileStatusStore.setState((s) => {
    let changed = false;
    for (const [k, v] of Object.entries(updates)) {
      if (s.statuses[k] !== v) { changed = true; break; }
    }
    if (!changed) return s;
    return { statuses: { ...s.statuses, ...updates } };
  });
}

function setMachineTypes(updates: Record<string, MachineType>) {
  useProfileStatusStore.setState((s) => {
    let changed = false;
    for (const [k, v] of Object.entries(updates)) {
      if (s.machineTypes[k] !== v) { changed = true; break; }
    }
    if (!changed) return s;
    return { machineTypes: { ...s.machineTypes, ...updates } };
  });
}

function syncUserOnlineStatus() {
  const user = useAuthStore.getState().user;
  if (!user) return;
  const connected = useEventStore.getState().connected;
  setStatus(user.user_id, connected ? "online" : "offline");
}

/**
 * Stop the shared poll interval when no agents remain in the active set.
 */
function stopPollIntervalIfIdle(): void {
  if (_remoteAgentIds.size === 0 && _pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = undefined;
  }
}

/**
 * Remove an agent from the polled set entirely AND clear its status. Used
 * when the agent is gone / no longer a remote agent (HTTP 400/404/410) so a
 * later `registerRemoteAgents` call can re-arm it.
 */
function unregisterRemoteAgent(agentId: string): void {
  _remoteAgentIds.delete(agentId);
  _polledAgentIds.delete(agentId);
  _pollFailureCounts.delete(agentId);
  useProfileStatusStore.setState((s) => {
    if (!(agentId in s.statuses) && !(agentId in s.machineTypes)) return s;
    const nextStatuses = { ...s.statuses };
    const nextMachineTypes = { ...s.machineTypes };
    delete nextStatuses[agentId];
    delete nextMachineTypes[agentId];
    return { statuses: nextStatuses, machineTypes: nextMachineTypes };
  });
  stopPollIntervalIfIdle();
}

/**
 * Stop polling an agent that has settled into a terminal state (`error` /
 * `stopped`) or has failed too many times, WITHOUT clearing its status —
 * the badge keeps showing the terminal state. Re-armed by a later
 * `registerRemoteAgents` (list refresh) or a non-terminal
 * `RemoteAgentStateChanged` push (see the WS handler in `init`). This is
 * what stops the `/remote_agent/state` 502/404 flood on a dead or
 * stuck-provisioning remote agent instead of polling every 30 s forever.
 */
function pauseRemoteAgentPolling(agentId: string): void {
  _remoteAgentIds.delete(agentId);
  // Drop from `_polledAgentIds` too so `registerRemoteAgents` treats the
  // agent as new and re-arms polling on the next list refresh.
  _polledAgentIds.delete(agentId);
  _pollFailureCounts.delete(agentId);
  stopPollIntervalIfIdle();
}

/**
 * Re-add a remote agent to the active poll set and (re-)arm the shared
 * interval. Shared by `registerRemoteAgents` and the WS re-engagement path.
 */
function armRemoteAgentPolling(agentId: string): void {
  _polledAgentIds.add(agentId);
  _remoteAgentIds.add(agentId);
  if (!_pollInterval) {
    _pollInterval = setInterval(pollRemoteAgents, REMOTE_POLL_MS);
  }
}

/**
 * HTTP statuses that indicate the agent is no longer (or never was) a
 * pollable remote agent. On these we drop it from the poll set rather than
 * spamming `/remote_agent/state` every 30 s forever.
 */
const TERMINAL_REMOTE_STATUSES = new Set<number>([400, 404, 410]);

/**
 * VM lifecycle states that won't change without an explicit user action
 * (recover / start). Polling stops here and re-engages via the WS push.
 */
const TERMINAL_VM_STATES = new Set<string>(["error", "stopped"]);

/**
 * Consecutive transport/5xx failures (e.g. `502` while the runtime is
 * unreachable) tolerated before we pause polling. A handful of retries
 * rides out a transient gateway blip on a healthy agent; a persistently
 * unreachable agent (e.g. pod stuck unschedulable) settles after this.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;
const _pollFailureCounts = new Map<string, number>();

function pollRemoteAgents() {
  for (const agentId of _remoteAgentIds) {
    api.swarm
      .getRemoteAgentState(agentId)
      .then((vm) => {
        _pollFailureCounts.delete(agentId);
        setStatus(agentId, vm.state);
        // Settled terminal state — stop polling but keep showing it.
        if (TERMINAL_VM_STATES.has(vm.state)) {
          pauseRemoteAgentPolling(agentId);
        }
      })
      .catch((err: unknown) => {
        if (
          err instanceof ApiClientError &&
          TERMINAL_REMOTE_STATUSES.has(err.status)
        ) {
          unregisterRemoteAgent(agentId);
          return;
        }
        setStatus(agentId, "error");
        const failures = (_pollFailureCounts.get(agentId) ?? 0) + 1;
        _pollFailureCounts.set(agentId, failures);
        if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          pauseRemoteAgentPolling(agentId);
        }
      });
  }
}

export const useProfileStatusStore = create<ProfileStatusState>()((_, get) => ({
  statuses: {},
  machineTypes: {},

  init: () => {
    if (_initialized) return;
    _initialized = true;

    const subscribe = useEventStore.getState().subscribe;

    subscribe(EventType.RemoteAgentStateChanged, (event) => {
      const { agent_id, state } = event.content ?? {};
      if (!agent_id || !state) return;
      setStatus(agent_id, state);
      // Re-engagement: if a known remote agent that we paused (terminal /
      // too many failures) reports a non-terminal state again — e.g. a
      // user-triggered recovery moved it back to `provisioning` — resume
      // polling so its live VM details refresh. Agents dropped via
      // `unregisterRemoteAgent` (404/410) have their `machineTypes` entry
      // cleared, so they intentionally do NOT re-engage here — they re-arm
      // only when a later `registerRemoteAgents` (list refresh) re-adds them.
      if (
        get().machineTypes[agent_id] === "remote" &&
        !TERMINAL_VM_STATES.has(state) &&
        !_remoteAgentIds.has(agent_id)
      ) {
        _pollFailureCounts.delete(agent_id);
        armRemoteAgentPolling(agent_id);
      }
    });

    subscribe(EventType.AgentInstanceUpdated, (event) => {
      const inst = event.content?.agent_instance;
      if (!inst) return;
      const updates: Record<string, string> = {};
      updates[inst.agent_instance_id] = inst.status;
      if (!_remoteAgentIds.has(inst.agent_id)) {
        updates[inst.agent_id] = inst.status;
      }
      setStatuses(updates);
    });

    subscribe(EventType.TaskStarted, (event) => {
      const agentId = event.agent_id;
      if (!agentId || _remoteAgentIds.has(agentId)) return;
      _activeTaskAgents.add(agentId);
      setStatus(agentId, "working");
    });

    const clearTask = (event: { agent_id: string }) => {
      const agentId = event.agent_id;
      if (!agentId || _remoteAgentIds.has(agentId)) return;
      _activeTaskAgents.delete(agentId);
      if (!_activeTaskAgents.has(agentId)) {
        const current = get().statuses[agentId];
        if (current === "working") setStatus(agentId, "idle");
      }
    };
    subscribe(EventType.TaskCompleted, clearTask);
    subscribe(EventType.TaskFailed, clearTask);

    subscribe(EventType.LoopStarted, (event) => {
      const agentId = event.agent_id;
      if (agentId && !_remoteAgentIds.has(agentId)) {
        setStatus(agentId, "working");
      }
    });

    const clearLoop = (event: { agent_id: string }) => {
      const agentId = event.agent_id;
      if (!agentId || _remoteAgentIds.has(agentId)) return;
      if (!_activeTaskAgents.has(agentId)) {
        setStatus(agentId, "idle");
      }
    };
    subscribe(EventType.LoopPaused, clearLoop);
    subscribe(EventType.LoopStopped, clearLoop);
    subscribe(EventType.LoopFinished, clearLoop);

    // Track the multi-id streaming set so per-agent profile status
    // flips correctly when several agents stream concurrently. The
    // previous single-string subscription would mark an agent "idle"
    // any time *another* agent started streaming, because the derived
    // most-recent id moved off the still-active stream.
    let _prevStreamingIds: string[] = [];
    useSidekickStore.subscribe((state) => {
      const nextIds = state.streamingAgentInstanceIds;
      if (
        nextIds === _prevStreamingIds ||
        (nextIds.length === _prevStreamingIds.length &&
          nextIds.every((id, i) => id === _prevStreamingIds[i]))
      ) {
        return;
      }
      const prevSet = new Set(_prevStreamingIds);
      const nextSet = new Set(nextIds);
      const stoppedIds = _prevStreamingIds.filter((id) => !nextSet.has(id));
      const startedIds = nextIds.filter((id) => !prevSet.has(id));
      _prevStreamingIds = nextIds.slice();

      const onUpdate = useSidekickStore.getState().onAgentInstanceUpdate;
      for (const stoppedId of stoppedIds) {
        const unsub = onUpdate((inst) => {
          if (inst.agent_instance_id === stoppedId && !_remoteAgentIds.has(inst.agent_id)) {
            if (!_activeTaskAgents.has(inst.agent_id)) {
              setStatuses({
                [inst.agent_id]: inst.status,
                [inst.agent_instance_id]: inst.status,
              });
            }
          }
          unsub();
        });
        setTimeout(unsub, 5000);
      }
      for (const startedId of startedIds) {
        const unsub = onUpdate((inst) => {
          if (inst.agent_instance_id === startedId) {
            const updates: Record<string, string> = {
              [inst.agent_instance_id]: "working",
            };
            if (!_remoteAgentIds.has(inst.agent_id)) {
              updates[inst.agent_id] = "working";
            }
            setStatuses(updates);
            unsub();
          }
        });
        setTimeout(unsub, 5000);
      }
    });

    let _prevConnected: boolean | null = null;
    useEventStore.subscribe((state) => {
      if (state.connected === _prevConnected) return;
      _prevConnected = state.connected;
      syncUserOnlineStatus();
    });
    let _prevUserId: string | null = null;
    useAuthStore.subscribe((state) => {
      const uid = state.user?.user_id ?? null;
      if (uid === _prevUserId) return;
      _prevUserId = uid;
      syncUserOnlineStatus();
    });
    syncUserOnlineStatus();
  },

  registerAgents: (agents) => {
    const updates: Record<string, MachineType> = {};
    for (const a of agents) {
      const mt = normalizeMachineType(a.machineType);
      updates[a.id] = mt;
    }
    setMachineTypes(updates);
  },

  registerRemoteAgents: (agents) => {
    let newAgents = false;
    const mtUpdates: Record<string, MachineType> = {};
    for (const a of agents) {
      mtUpdates[a.agent_id] = "remote";
      if (!_polledAgentIds.has(a.agent_id)) {
        armRemoteAgentPolling(a.agent_id);
        newAgents = true;
      }
    }
    setMachineTypes(mtUpdates);
    if (!newAgents) return;

    pollRemoteAgents();
  },
}));

/** Idempotent: register event/auth/sidekick subscriptions once a session exists (not at module load). */
export function ensureProfileStatusRealtimeInitialized(): void {
  useProfileStatusStore.getState().init();
}
