import { useState, useEffect, useCallback, useRef } from "react";
import { create } from "zustand";
import {
  api,
  type AgentBusyErrorInfo,
  type HarnessCapacityExhaustedInfo,
} from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../shared/types/aura-events";
import { useIsStreaming } from "./stream/hooks";

export type { AgentBusyErrorInfo } from "../api/client";

/**
 * Local long-lived busy reasons (computed from the user's own client
 * state):
 * - `"chat"`     — our own chat SSE is streaming a turn.
 * - `"loop"`     — automation loop / single-task automaton is running
 *                  on the same upstream agent partition.
 * - `"queue_full"` — the most recent send was rejected because more
 *                  than the bounded number of turns are queued behind
 *                  the in-flight turn (Phase 3 server signal).
 * - `"server_busy"` — Phase 6: the upstream `aura-node` WS-slot
 *                  semaphore is exhausted. Distinct from `queue_full`
 *                  because the cause is a global server-side limit,
 *                  not this partition's pending-turn count.
 */
export type AgentBusyReason =
  | "chat"
  | "loop"
  | "queue_full"
  | "server_busy"
  | null;

export interface AgentBusy {
  isBusy: boolean;
  reason: AgentBusyReason;
  /**
   * When the busy condition is caused by a running automaton (either
   * the local `loop` event for this agent or a server `agent_busy`
   * response that pinpointed the holder), the automaton's id. Lets
   * the consumer render a "Stop the loop to chat" affordance that
   * targets the specific automaton instead of guessing.
   */
  automatonId?: string;
  /**
   * Phase 6: when `reason === "server_busy"`, the server's hint for
   * how long to wait before retrying. Surfaced from the structured
   * `harness_capacity_exhausted` 503 payload so the input bar can
   * say "Server is busy — try again in N seconds." instead of
   * leaking the raw 503.
   */
  retryAfterSeconds?: number;
}

/* ------------------------------------------------------------------ */
/*  Server-reported agent_busy errors                                  */
/*                                                                     */
/*  The chat HTTP routes return `ApiError::agent_busy` (Phase 2) when  */
/*  a new send races an in-flight turn or queues full (Phase 3). The   */
/*  catching site (e.g. `use-chat-stream` lifecycle) parses the error  */
/*  with `isAgentBusyError`. To surface the structured reason +        */
/*  automaton_id from `useAgentBusy` so the input bar can render the   */
/*  right copy and the right "stop" target, we keep a short-lived map  */
/*  of the most recent server signal per agent instance.               */
/* ------------------------------------------------------------------ */

/**
 * Stored signal kind. Phase 2 / 3 emit `agent_busy`; Phase 6 emits
 * `harness_capacity_exhausted`. Both share the same per-(project,
 * instance) store + TTL machinery so the hook can surface whichever
 * fired most recently with a single short-lived banner.
 */
type StoredAgentBusySignal =
  | { kind: "agent_busy"; info: AgentBusyErrorInfo }
  | { kind: "harness_capacity_exhausted"; info: HarnessCapacityExhaustedInfo };

interface AgentBusyServerStore {
  signals: Record<string, StoredAgentBusySignal>;
  recordSignal: (key: string, signal: StoredAgentBusySignal) => void;
  clearSignal: (key: string) => void;
}

/** TTL for a server-reported signal before it self-expires. */
const AGENT_BUSY_SIGNAL_TTL_MS = 8_000;

/**
 * Phase 6 fallback: the harness `harness_capacity_exhausted` 503
 * payload includes a `retry_after_seconds` hint. If the wire shape is
 * missing it (older server build, `data` field stripped by a proxy),
 * we still surface a sensible "try again soon" message rather than a
 * blank one.
 */
const HARNESS_CAPACITY_DEFAULT_RETRY_SECONDS = 5;

const expirationTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useAgentBusyServerStore = create<AgentBusyServerStore>((set) => ({
  signals: {},
  recordSignal: (key, signal) => {
    const existing = expirationTimers.get(key);
    if (existing) clearTimeout(existing);
    set((s) => ({
      signals: { ...s.signals, [key]: signal },
    }));
    const timer = setTimeout(() => {
      expirationTimers.delete(key);
      set((s) => {
        if (!(key in s.signals)) return s;
        const next = { ...s.signals };
        delete next[key];
        return { signals: next };
      });
    }, AGENT_BUSY_SIGNAL_TTL_MS);
    expirationTimers.set(key, timer);
  },
  clearSignal: (key) => {
    const existing = expirationTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      expirationTimers.delete(key);
    }
    set((s) => {
      if (!(key in s.signals)) return s;
      const next = { ...s.signals };
      delete next[key];
      return { signals: next };
    });
  },
}));

/**
 * Compose the per-(project, instance) key used by the agent-busy
 * server-signal map. Project id may be missing for the standalone
 * agent surface; the agent instance id is the canonical client-side
 * partition key.
 */
export function agentBusyKey(
  projectId: string | undefined,
  agentInstanceId: string | undefined,
): string {
  return `${projectId ?? "_"}:${agentInstanceId ?? "_"}`;
}

/**
 * Stamp a server-reported `agent_busy` rejection so `useAgentBusy`
 * surfaces the right reason and automaton_id for ~8s. Call this from
 * the chat send path after `isAgentBusyError(err)` returns a value.
 */
export function recordAgentBusySignal(
  projectId: string | undefined,
  agentInstanceId: string | undefined,
  info: AgentBusyErrorInfo,
): void {
  useAgentBusyServerStore
    .getState()
    .recordSignal(agentBusyKey(projectId, agentInstanceId), {
      kind: "agent_busy",
      info,
    });
}

/**
 * Phase 6: stamp a server-reported `harness_capacity_exhausted` 503
 * so `useAgentBusy` surfaces a "Server is busy — try again in a few
 * seconds." reading for ~8s. Call this from the chat / runtime / spec
 * / extraction error paths after
 * `isHarnessCapacityExhaustedError(err)` returns a value.
 */
export function recordHarnessCapacityExhaustedSignal(
  projectId: string | undefined,
  agentInstanceId: string | undefined,
  info: HarnessCapacityExhaustedInfo,
): void {
  useAgentBusyServerStore
    .getState()
    .recordSignal(agentBusyKey(projectId, agentInstanceId), {
      kind: "harness_capacity_exhausted",
      info,
    });
}

/**
 * Clear any pending server signal — typically called on a successful
 * subsequent send so the UI doesn't keep showing stale copy.
 */
export function clearAgentBusySignal(
  projectId: string | undefined,
  agentInstanceId: string | undefined,
): void {
  useAgentBusyServerStore
    .getState()
    .clearSignal(agentBusyKey(projectId, agentInstanceId));
}

/**
 * Track whether a specific project-scoped agent instance is currently
 * busy from the *user's* perspective — either the main chat SSE is
 * streaming a turn, the automation loop is running a task against
 * the same agent upstream, or the server most recently rejected a
 * send with `agent_busy` (Phase 2 / Phase 3).
 *
 * This exists because the upstream harness enforces one in-flight turn
 * per agent partition (`/v1/agents/{id}/...` shared by chat sessions
 * and automatons). Without a combined signal the chat input would keep
 * showing the send arrow while the loop was already holding the agent,
 * and any `UserMessage` would be rejected by the harness with the raw
 * "A turn is currently in progress; send cancel first" error — with no
 * stop icon for the user to cancel.
 *
 * The hook also exposes `automatonId` (when known) so the consumer can
 * render a "Stop the loop to chat" button targeted at the specific
 * automaton, and distinguishes `queue_full` from the automation
 * conflict so the copy stays accurate.
 */
export function useAgentBusy(params: {
  projectId: string | undefined;
  agentInstanceId: string | undefined;
  streamKey: string;
}): AgentBusy {
  const { projectId, agentInstanceId, streamKey } = params;
  const chatStreaming = useIsStreaming(streamKey);
  const { active: loopActive, automatonId: loopAutomatonId } =
    useLoopActiveForAgent(projectId, agentInstanceId);
  const serverSignal = useAgentBusyServerStore(
    (s) => s.signals[agentBusyKey(projectId, agentInstanceId)],
  );

  if (chatStreaming) return { isBusy: true, reason: "chat" };
  if (loopActive) {
    return { isBusy: true, reason: "loop", automatonId: loopAutomatonId };
  }

  if (serverSignal) {
    if (serverSignal.kind === "harness_capacity_exhausted") {
      return {
        isBusy: true,
        reason: "server_busy",
        retryAfterSeconds:
          serverSignal.info.retry_after_seconds ??
          HARNESS_CAPACITY_DEFAULT_RETRY_SECONDS,
      };
    }
    const info = serverSignal.info;
    if (info.reason === "queue_full") {
      return { isBusy: true, reason: "queue_full" };
    }
    if (info.reason === "automation_running") {
      return {
        isBusy: true,
        reason: "loop",
        automatonId: info.automaton_id,
      };
    }
  }

  return { isBusy: false, reason: null };
}

/**
 * Whether the automation loop is currently running a task for a
 * specific agent instance inside a project. Seeded from
 * `/loop/status.active_agent_instances` and kept live via the
 * `LoopStarted` / `LoopStopped` / `LoopFinished` WS events — which
 * stamp the participating agent instance id as `agent_id` (see
 * `parseAuraEvent` in `types/aura-events.ts`). `LoopStarted` carries
 * the running automaton id when available so the chat surface can
 * target it from the "Stop to chat" affordance.
 */
function useLoopActiveForAgent(
  projectId: string | undefined,
  agentInstanceId: string | undefined,
): { active: boolean; automatonId?: string } {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  const [active, setActive] = useState(false);
  const [automatonId, setAutomatonId] = useState<string | undefined>(undefined);

  const matches = useCallback(
    (evt: { project_id?: string; agent_id?: string }) =>
      !!projectId &&
      !!agentInstanceId &&
      evt.project_id === projectId &&
      evt.agent_id === agentInstanceId,
    [projectId, agentInstanceId],
  );

  const fetchStatus = useCallback(async () => {
    if (!projectId || !agentInstanceId) return false;
    try {
      const res = await api.getLoopStatus(projectId);
      return !!res.active_agent_instances?.includes(agentInstanceId);
    } catch {
      return false;
    }
  }, [projectId, agentInstanceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((next) => {
      if (!cancelled) {
        setActive(next);
        if (!next) setAutomatonId(undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      void fetchStatus().then((next) => {
        setActive(next);
        if (!next) setAutomatonId(undefined);
      });
    }
    prevConnectedRef.current = connected;
  }, [connected, fetchStatus]);

  useEffect(() => {
    if (!projectId || !agentInstanceId) return;
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (matches(e)) {
          setActive(true);
          const id = e.content?.automaton_id;
          if (typeof id === "string" && id.length > 0) setAutomatonId(id);
        }
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (matches(e)) {
          setActive(false);
          setAutomatonId(undefined);
        }
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (matches(e)) {
          setActive(false);
          setAutomatonId(undefined);
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, matches, projectId, agentInstanceId]);

  return { active, automatonId };
}
