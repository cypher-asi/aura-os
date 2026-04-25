import { create } from "zustand";

import { api } from "../api/client";
import type { LoopsFilter } from "../shared/api/loop";
import {
  isLoopActivityActive,
  type LoopActivityPayload,
  type LoopIdPayload,
} from "../shared/types/aura-events";

/**
 * Single source of truth for per-loop activity state in the UI.
 *
 * Every piece of UI that shows a spinning circular progress indicator
 * (the agent list, the sidekick tab bar, task / run rows) subscribes
 * here. The store is fed by:
 *
 * - `loop_opened` / `loop_activity_changed` / `loop_ended` WebSocket
 *   events (upsert / remove by `loop_id.instance`).
 * - `GET /api/loops` snapshots on boot and on every WS reconnect, so
 *   the indicator reflects reality even if we missed an event across
 *   a disconnect.
 *
 * A per-store watchdog demotes activity that has not emitted an event
 * in `STALL_THRESHOLD_MS` to `status: "stalled"` so the UI can render
 * a muted spinner instead of an always-active one when the harness
 * stream wedges.
 */

export interface LoopRow {
  loopId: LoopIdPayload;
  activity: LoopActivityPayload;
}

interface LoopActivityState {
  /** Keyed by `loop_id.instance` (the UUID the backend generates per
   *  loop). Guarantees two loops for the same (project, instance,
   *  agent) tuple stay distinct. */
  loops: Record<string, LoopRow>;
  /** `true` after the first snapshot fetch completes for a user session.
   *  Selectors can gate on this to avoid flashing "idle" before the
   *  initial fetch returns. */
  hydrated: boolean;

  upsert: (loopId: LoopIdPayload, activity: LoopActivityPayload) => void;
  remove: (instance: string) => void;
  replaceSnapshot: (rows: LoopRow[]) => void;
  hydrate: (filter?: LoopsFilter) => Promise<void>;
  markStalled: (cutoffMs: number) => void;
}

/** Milliseconds since `last_event_at` after which we demote a loop to
 *  the `stalled` status. The backend doesn't force this transition
 *  unconditionally because the spinner should keep rotating during
 *  real work; the watchdog runs per-client so a network hiccup only
 *  affects the local UI. */
const STALL_THRESHOLD_MS = 60_000;

export const useLoopActivityStore = create<LoopActivityState>()((set, get) => ({
  loops: {},
  hydrated: false,

  upsert: (loopId, activity) =>
    set((state) => ({
      loops: {
        ...state.loops,
        [loopId.instance]: { loopId, activity },
      },
    })),

  remove: (instance) =>
    set((state) => {
      if (!(instance in state.loops)) return state;
      const next = { ...state.loops };
      delete next[instance];
      return { loops: next };
    }),

  replaceSnapshot: (rows) =>
    set(() => ({
      loops: Object.fromEntries(rows.map((row) => [row.loopId.instance, row])),
      hydrated: true,
    })),

  hydrate: async (filter) => {
    try {
      const res = await api.listLoops(filter);
      const rows: LoopRow[] = res.loops.map((entry) => ({
        loopId: entry.loop_id,
        activity: entry.activity,
      }));
      get().replaceSnapshot(rows);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to hydrate loop activity", error);
      }
    }
  },

  markStalled: (cutoffMs) =>
    set((state) => {
      let changed = false;
      const next: Record<string, LoopRow> = {};
      for (const [key, row] of Object.entries(state.loops)) {
        const lastEvent = Date.parse(row.activity.last_event_at);
        if (
          Number.isFinite(lastEvent) &&
          lastEvent < cutoffMs &&
          row.activity.status !== "stalled" &&
          isLoopActivityActive(row.activity.status)
        ) {
          next[key] = {
            loopId: row.loopId,
            activity: { ...row.activity, status: "stalled" },
          };
          changed = true;
        } else {
          next[key] = row;
        }
      }
      return changed ? { loops: next } : state;
    }),
}));

/* ── Selectors ──────────────────────────────────────────────────────
 * These return deterministic aggregates used by the `<LoopProgress />`
 * component to decide whether to render a spinner and what progress
 * fraction to show. They intentionally re-compute on every store
 * change; the map is small (bounded by live loops in the UI).
 * ------------------------------------------------------------------ */

function aggregateRows(rows: LoopRow[]): LoopActivityPayload | null {
  if (rows.length === 0) return null;
  const active = rows.filter((r) => isLoopActivityActive(r.activity.status));
  if (active.length === 0) {
    return rows[0]?.activity ?? null;
  }
  const percents = active
    .map((r) => r.activity.percent)
    .filter((p): p is number => typeof p === "number");
  const percent =
    percents.length === 0
      ? null
      : percents.reduce((s, p) => s + p, 0) / percents.length;
  const oldestStart = active
    .map((r) => Date.parse(r.activity.started_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const latestEvent = active
    .map((r) => Date.parse(r.activity.last_event_at))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const representative = active[0]?.activity;
  if (!representative) return null;
  return {
    ...representative,
    percent,
    started_at: Number.isFinite(oldestStart)
      ? new Date(oldestStart).toISOString()
      : representative.started_at,
    last_event_at: Number.isFinite(latestEvent)
      ? new Date(latestEvent).toISOString()
      : representative.last_event_at,
  };
}

export function selectAgentInstanceActivity(
  state: LoopActivityState,
  agentInstanceId: string | null | undefined,
): LoopActivityPayload | null {
  if (!agentInstanceId) return null;
  const rows = Object.values(state.loops).filter(
    (row) => row.loopId.agent_instance_id === agentInstanceId,
  );
  return aggregateRows(rows);
}

/**
 * Aggregates across every loop that belongs to the given template
 * `agent_id`, regardless of project / instance. Used by the sidebar
 * agent list which renders one row per template and should pulse
 * whenever ANY instance of that agent is working. Chat loops
 * typically have no `project_id` but always have `agent_id`, so they
 * flow through this selector too.
 */
export function selectAgentActivity(
  state: LoopActivityState,
  agentId: string | null | undefined,
): LoopActivityPayload | null {
  if (!agentId) return null;
  const rows = Object.values(state.loops).filter(
    (row) => row.loopId.agent_id === agentId,
  );
  return aggregateRows(rows);
}

export function selectProjectActivity(
  state: LoopActivityState,
  projectId: string | null | undefined,
): LoopActivityPayload | null {
  if (!projectId) return null;
  const rows = Object.values(state.loops).filter(
    (row) => row.loopId.project_id === projectId,
  );
  return aggregateRows(rows);
}

export function selectTaskActivity(
  state: LoopActivityState,
  taskId: string | null | undefined,
): LoopActivityPayload | null {
  if (!taskId) return null;
  const rows = Object.values(state.loops).filter(
    (row) => row.activity.current_task_id === taskId,
  );
  return aggregateRows(rows);
}

/* ── Watchdog ──────────────────────────────────────────────────────
 * Starts a lightweight interval that demotes idle loops to `stalled`.
 * Exported so the auth bootstrap can start it exactly once, and stops
 * it on logout / HMR dispose.
 * ------------------------------------------------------------------ */

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function startLoopActivityWatchdog(): void {
  if (watchdogTimer !== null) return;
  watchdogTimer = setInterval(() => {
    const cutoff = Date.now() - STALL_THRESHOLD_MS;
    useLoopActivityStore.getState().markStalled(cutoff);
  }, 15_000);
}

export function stopLoopActivityWatchdog(): void {
  if (watchdogTimer === null) return;
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopLoopActivityWatchdog();
  });
}
