import { create } from "zustand";
import { api } from "../api/client";
import { useEventStore } from "./event-store";
import { useAuthStore } from "./auth-store";
import { useSidekickStore } from "./sidekick-store";
import { EventType } from "../types/aura-events";

const REMOTE_POLL_MS = 30_000;

interface ProfileStatusState {
  statuses: Record<string, string>;
  init: () => void;
  registerRemoteAgents: (agents: { agent_id: string }[]) => void;
}

let _initialized = false;
const _polledAgentIds = new Set<string>();
let _pollInterval: ReturnType<typeof setInterval> | undefined;
const _remoteAgentIds = new Set<string>();

/** Agent IDs with at least one active task (frontend-tracked). */
const _activeTaskAgents = new Set<string>();

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

function syncUserOnlineStatus() {
  const user = useAuthStore.getState().user;
  if (!user) return;
  const connected = useEventStore.getState().connected;
  setStatus(user.user_id, connected ? "online" : "offline");
}

function pollRemoteAgents() {
  for (const agentId of _remoteAgentIds) {
    api.swarm
      .getRemoteAgentState(agentId)
      .then((vm) => setStatus(agentId, vm.state))
      .catch(() => {});
  }
}

export const useProfileStatusStore = create<ProfileStatusState>()((_, get) => ({
  statuses: {},

  init: () => {
    if (_initialized) return;
    _initialized = true;

    const subscribe = useEventStore.getState().subscribe;

    subscribe(EventType.RemoteAgentStateChanged, (event) => {
      const { agent_id, state } = event.content ?? {};
      if (agent_id && state) setStatus(agent_id, state);
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

    let _prevStreamingId: string | null = null;
    useSidekickStore.subscribe((state) => {
      const streamingId = state.streamingAgentInstanceId;
      if (streamingId === _prevStreamingId) return;
      const prevId = _prevStreamingId;
      _prevStreamingId = streamingId;

      if (prevId) {
        const onUpdate = useSidekickStore.getState().onAgentInstanceUpdate;
        const unsub = onUpdate((inst) => {
          if (inst.agent_instance_id === prevId && !_remoteAgentIds.has(inst.agent_id)) {
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
      if (streamingId) {
        const onUpdate = useSidekickStore.getState().onAgentInstanceUpdate;
        const unsub = onUpdate((inst) => {
          if (inst.agent_instance_id === streamingId) {
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

  registerRemoteAgents: (agents) => {
    let newAgents = false;
    for (const a of agents) {
      if (!_polledAgentIds.has(a.agent_id)) {
        _polledAgentIds.add(a.agent_id);
        _remoteAgentIds.add(a.agent_id);
        newAgents = true;
      }
    }
    if (!newAgents) return;

    pollRemoteAgents();

    if (!_pollInterval) {
      _pollInterval = setInterval(pollRemoteAgents, REMOTE_POLL_MS);
    }
  },
}));

export function useProfileStatus(id: string | undefined): string | undefined {
  return useProfileStatusStore((s) => (id ? s.statuses[id] : undefined));
}

if (typeof window !== "undefined") {
  useProfileStatusStore.getState().init();
}
