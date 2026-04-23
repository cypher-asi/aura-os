import { useEffect } from "react";
import { api } from "../api/client";
import {
  useEventStore,
  useTaskOutput,
  getCachedTaskOutputText,
  type TaskOutputEntry,
} from "../stores/event-store/index";
import { hydrateTaskOutputOnce } from "../stores/task-output-hydration-cache";
import {
  persistTaskTurns,
  readTaskTurns,
} from "../stores/task-turn-cache";
import { taskStreamKey } from "../stores/task-stream-bootstrap";
import { seedStreamEventsFromCache } from "./stream/store";
import { useStreamEvents } from "./stream/hooks";
import type { DisplaySessionEvent } from "../types/stream";

/* ------------------------------------------------------------------ */
/*  Unified task output view                                           */
/*                                                                     */
/*  Collapses the three-layer storage model (stream store, event       */
/*  store, server) into a single reactive view for consumers. Load     */
/*  order:                                                             */
/*                                                                     */
/*    1. Live stream-store entry (events, text, build/test/git steps). */
/*    2. Persisted turn cache (task-turn-cache) — rehydrated into the  */
/*       stream store so MessageBubble / LLMOutput render full         */
/*       structure (timeline, tool cards, thinking).                   */
/*    3. Event-store `taskOutput.text` (text-only fallback, already    */
/*       persisted to localStorage via task-output-cache).             */
/*    4. Server hydration via `api.getTaskOutput` — single-flight'd    */
/*       through the existing hydration cache so orphan runs never     */
/*       loop.                                                         */
/*                                                                     */
/*  The hook also persists the freshly-materialized events back into   */
/*  the turn cache whenever the live stream gains a new finalized      */
/*  event for a terminal task, so in-session work stays saved even     */
/*  if the terminal bus misses a TaskCompleted broadcast.              */
/* ------------------------------------------------------------------ */

export interface TaskOutputView {
  streamKey: string;
  events: DisplaySessionEvent[];
  taskOutput: TaskOutputEntry;
  fallbackText: string;
  hasStructuredContent: boolean;
  hasAnyContent: boolean;
}

export function useTaskOutputView(
  taskId: string | undefined,
  projectId: string | undefined,
  isTerminal: boolean,
): TaskOutputView {
  const streamKey = taskId ? taskStreamKey(taskId) : "task:";
  const events = useStreamEvents(streamKey);
  const taskOutput = useTaskOutput(taskId);
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);

  // 1. Seed the stream-store events from the persisted turn cache the
  //    first time a terminal row mounts while the live entry is empty.
  useEffect(() => {
    if (!taskId) return;
    if (!isTerminal) return;
    if (events.length > 0) return;
    const cached = readTaskTurns(taskId, projectId);
    if (cached.length > 0) {
      seedStreamEventsFromCache(streamKey, cached);
    }
  }, [taskId, projectId, isTerminal, events.length, streamKey]);

  // 2. Hydrate text / build / test steps from localStorage + server
  //    when nothing structured is available.
  useEffect(() => {
    if (!taskId || !projectId) return;
    if (!isTerminal) return;
    // If we already have structured events, skip the text hydration —
    // the events already contain the rendered turn. We still run the
    // text path when events are empty so the "raw text" fallback has
    // something to show if the turn cache is also empty.
    if (events.length > 0) return;

    let cancelled = false;
    const existing = useEventStore.getState().taskOutputs[taskId];
    if (!existing?.text) {
      const cached = getCachedTaskOutputText(taskId, projectId);
      if (cached) {
        seedTaskOutput(taskId, cached, undefined, undefined, undefined, projectId);
      }
    }

    void hydrateTaskOutputOnce(projectId, taskId, async () => {
      const current = useEventStore.getState().taskOutputs[taskId];
      if (current?.text) return "loaded";
      try {
        const res = await api.getTaskOutput(projectId, taskId);
        if (cancelled) return "empty";
        if (res.output || res.build_steps?.length || res.test_steps?.length || res.git_steps?.length) {
          seedTaskOutput(taskId, res.output, undefined, undefined, undefined, projectId);
          return "loaded";
        }
        return "empty";
      } catch {
        return "empty";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [taskId, projectId, isTerminal, events.length, seedTaskOutput]);

  // 3. Mirror newly-materialized events back into the persistent turn
  //    cache. The task-stream-bootstrap writes on the TaskCompleted /
  //    TaskFailed broadcast, but if the live entry gains more events
  //    afterwards (e.g. from a delayed save or from this component
  //    seeding them from the server in the future) we keep the cache
  //    in sync.
  useEffect(() => {
    if (!taskId) return;
    if (!isTerminal) return;
    if (events.length === 0) return;
    persistTaskTurns(taskId, events, projectId);
  }, [taskId, projectId, isTerminal, events]);

  const hasStructuredContent = events.length > 0;
  const fallbackText = taskOutput.text;
  const hasAnyContent =
    hasStructuredContent ||
    !!fallbackText ||
    (taskOutput.buildSteps?.length ?? 0) > 0 ||
    (taskOutput.testSteps?.length ?? 0) > 0 ||
    (taskOutput.gitSteps?.length ?? 0) > 0;

  return {
    streamKey,
    events,
    taskOutput,
    fallbackText,
    hasStructuredContent,
    hasAnyContent,
  };
}
