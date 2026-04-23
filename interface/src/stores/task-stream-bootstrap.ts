import { EventType } from "../types/aura-events";
import type { AuraEvent, AuraEventOfType } from "../types/aura-events";
import { useEventStore, getTaskOutput } from "./event-store/index";
import {
  ensureEntry,
  createSetters,
  getStreamEntry,
  getThinkingDurationMs,
  streamMetaMap,
} from "../hooks/stream/store";
import { persistTaskTurns } from "./task-turn-cache";
import {
  resetStreamBuffers,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolResult,
  handleAssistantTurnBoundary,
  finalizeStream,
} from "../hooks/stream/handlers";
import { useTaskOutputPanelStore } from "./task-output-panel-store";
import type { StreamRefs, StreamSetters } from "../types/stream";
import type { MutableRefObject } from "react";

/* ------------------------------------------------------------------ */
/*  App-scoped task stream subscription bootstrap                      */
/*                                                                     */
/*  Registers WS event subscriptions ONCE per app lifetime (not per    */
/*  component mount). This eliminates the mount race where a task's    */
/*  `TextDelta` events would arrive in the same microtask batch as     */
/*  `TaskStarted`, before `ActiveTaskStream`'s `useEffect` had a       */
/*  chance to register its own subscriptions.                          */
/*                                                                     */
/*  The bootstrap owns:                                                */
/*    - `useTaskOutputPanelStore` entries (add/complete/fail)          */
/*    - per-task stream store entries (text/thinking/tools/timeline)   */
/*                                                                     */
/*  Views subscribe to the stream store as before via                  */
/*  `useStreamingText(streamKey)` etc. `useTaskStream` no longer       */
/*  registers per-component subscriptions.                             */
/* ------------------------------------------------------------------ */

export const TASK_STREAM_KEY_PREFIX = "task:";

export function taskStreamKey(taskId: string): string {
  return `${TASK_STREAM_KEY_PREFIX}${taskId}`;
}

// Tracks per-task `isStreaming` to drive finalizeStream correctly when
// task_completed / task_failed events arrive.
const isStreamingByTask = new Map<string, boolean>();

interface TaskStreamContext {
  key: string;
  refs: StreamRefs;
  setters: StreamSetters;
  abortRef: MutableRefObject<AbortController | null>;
}

function contextForTask(taskId: string): TaskStreamContext {
  const key = taskStreamKey(taskId);
  const meta = ensureEntry(key);
  const setters = createSetters(key);
  const abortRef: MutableRefObject<AbortController | null> = {
    get current() {
      return streamMetaMap.get(key)?.abort ?? null;
    },
    set current(value: AbortController | null) {
      const m = streamMetaMap.get(key);
      if (m) m.abort = value;
    },
  };
  return { key, refs: meta.refs, setters, abortRef };
}

function handleTaskStarted(e: AuraEventOfType<EventType.TaskStarted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  resetStreamBuffers(refs, setters);
  setters.setIsStreaming(true);
  isStreamingByTask.set(taskId, true);

  const projectId = e.project_id;
  if (projectId) {
    useTaskOutputPanelStore
      .getState()
      .addTask(taskId, projectId, e.content.task_title, e.agent_id ?? undefined);
  }
}

function handleTextDeltaEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const text = (c.text as string) ?? "";
  if (!text) return;
  const { key, refs, setters } = contextForTask(taskId);
  handleTextDelta(refs, setters, getThinkingDurationMs(key), text);
}

function handleThinkingDeltaEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const thinking = (c.thinking as string) ?? (c.text as string) ?? "";
  if (!thinking) return;
  const { refs, setters } = contextForTask(taskId);
  handleThinkingDelta(refs, setters, thinking);
}

function handleToolUseStartEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const rawId = typeof c.id === "string" ? c.id.trim() : "";
  handleToolCallStarted(refs, setters, {
    id: rawId || crypto.randomUUID(),
    name: (typeof c.name === "string" && c.name) || "unknown",
  });
}

function handleToolCallSnapshotEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const rawId = typeof c.id === "string" ? c.id.trim() : "";
  if (!rawId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolCallSnapshot(refs, setters, {
    id: rawId,
    name: (typeof c.name === "string" && c.name) || "unknown",
    input: (c.input as Record<string, unknown>) ?? {},
  });
}

function handleToolResultEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolResult(refs, setters, {
    id: c.id as string | undefined,
    name: (c.name as string) ?? "unknown",
    result: (c.result as string) ?? "",
    is_error: (c.is_error as boolean) ?? false,
  });
}

function handleAssistantMessageEndEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  handleAssistantTurnBoundary(refs, setters);
}

function handleProgressEvent(e: AuraEvent): void {
  const c = e.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const stage = (c.stage as string) ?? "";
  if (!stage) return;
  const { setters } = contextForTask(taskId);
  setters.setProgressText(stage);
}

function handleGitCommittedEvent(e: AuraEventOfType<EventType.GitCommitted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const sha = e.content.commit_sha?.slice(0, 7) ?? "";
  handleToolCallStarted(refs, setters, { id, name: "git_commit" });
  handleToolResult(refs, setters, {
    id,
    name: "git_commit",
    result: sha ? `Committed ${sha}` : "Committed",
    is_error: false,
  });
}

function handleGitCommitFailedEvent(
  e: AuraEventOfType<EventType.GitCommitFailed>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  handleToolCallStarted(refs, setters, { id, name: "git_commit" });
  handleToolResult(refs, setters, {
    id,
    name: "git_commit",
    result: e.content.reason ?? "Commit failed",
    is_error: true,
  });
}

function handleGitCommitRolledBackEvent(
  e: AuraEventOfType<EventType.GitCommitRolledBack>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const sha = e.content.commit_sha?.slice(0, 7) ?? "unknown";
  handleToolCallStarted(refs, setters, { id, name: "git_commit_rolled_back" });
  handleToolResult(refs, setters, {
    id,
    name: "git_commit_rolled_back",
    result: `Rolled back ${sha}: ${e.content.reason ?? "DoD gate rejected commit"}`,
    is_error: true,
  });
}

function handleGitPushedEvent(e: AuraEventOfType<EventType.GitPushed>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const count = e.content.commits?.length ?? 0;
  const branch = e.content.branch ?? "main";
  handleToolCallStarted(refs, setters, { id, name: "git_push" });
  handleToolResult(refs, setters, {
    id,
    name: "git_push",
    result: `Pushed ${count} commit${count !== 1 ? "s" : ""} to ${branch}`,
    is_error: false,
  });
}

function handleGitPushFailedEvent(
  e: AuraEventOfType<EventType.GitPushFailed>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  handleToolCallStarted(refs, setters, { id, name: "git_push" });
  handleToolResult(refs, setters, {
    id,
    name: "git_push",
    result: e.content.reason ?? "Push failed",
    is_error: true,
  });
}

function mergeBufferedOutput(taskId: string, streamBuffer: string, projectId?: string): void {
  if (!streamBuffer) return;
  const existingText = getTaskOutput(taskId).text;
  const mergedText = existingText.endsWith(streamBuffer)
    ? existingText
    : `${existingText}${streamBuffer}`;
  if (mergedText && mergedText !== existingText) {
    useEventStore
      .getState()
      .seedTaskOutput(taskId, mergedText, undefined, undefined, undefined, projectId);
  }
}

/**
 * Snapshot the finalized events for `taskId` into the persistent turn
 * cache so the Run panel and sidekick overlay can rehydrate a rich
 * post-completion view after the in-memory stream entry is pruned or
 * the page reloads. No-ops when no events have been captured yet.
 */
function snapshotTaskTurns(taskId: string, projectId?: string): void {
  const entry = getStreamEntry(taskStreamKey(taskId));
  if (!entry || entry.events.length === 0) return;
  persistTaskTurns(taskId, entry.events, projectId);
}

function handleTaskCompleted(e: AuraEventOfType<EventType.TaskCompleted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters, abortRef } = contextForTask(taskId);
  mergeBufferedOutput(taskId, refs.streamBuffer.current, e.project_id);
  finalizeStream(refs, setters, abortRef, isStreamingByTask.get(taskId) ?? false, {
    reason: "completed",
  });
  isStreamingByTask.delete(taskId);
  useTaskOutputPanelStore.getState().completeTask(taskId);
  snapshotTaskTurns(taskId, e.project_id);
}

function handleTaskFailed(e: AuraEventOfType<EventType.TaskFailed>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters, abortRef } = contextForTask(taskId);
  mergeBufferedOutput(taskId, refs.streamBuffer.current, e.project_id);
  finalizeStream(refs, setters, abortRef, isStreamingByTask.get(taskId) ?? false, {
    reason: "failed",
    message: e.content.reason ?? undefined,
  });
  isStreamingByTask.delete(taskId);
  useTaskOutputPanelStore.getState().failTask(taskId);
  snapshotTaskTurns(taskId, e.project_id);
}

function handleLoopEnd(): void {
  // Snapshot any task rows we flip to "completed" so reopening the
  // Run panel after a LoopFinished/LoopStopped event still renders
  // their structured turn history from cache.
  const panel = useTaskOutputPanelStore.getState();
  const activeTasks = panel.tasks.filter((t) => t.status === "active");
  panel.markAllCompleted();
  for (const task of activeTasks) {
    snapshotTaskTurns(task.taskId, task.projectId);
  }
  isStreamingByTask.clear();
}

let bootstrapped = false;
let registeredDisposers: Array<() => void> = [];

/**
 * Installs the app-scoped task stream subscriptions. Safe to call
 * multiple times — re-invocations no-op until `teardownTaskStreamBootstrap`
 * is used (test-only).
 */
export function bootstrapTaskStreamSubscriptions(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  const subscribe = useEventStore.getState().subscribe;
  registeredDisposers = [
    subscribe(EventType.TaskStarted, handleTaskStarted),
    subscribe(EventType.TextDelta, handleTextDeltaEvent),
    subscribe(EventType.ThinkingDelta, handleThinkingDeltaEvent),
    subscribe(EventType.ToolUseStart, handleToolUseStartEvent),
    subscribe(EventType.ToolCallSnapshot, handleToolCallSnapshotEvent),
    subscribe(EventType.ToolResult, handleToolResultEvent),
    subscribe(EventType.AssistantMessageEnd, handleAssistantMessageEndEvent),
    subscribe(EventType.Progress, handleProgressEvent),
    subscribe(EventType.GitCommitted, handleGitCommittedEvent),
    subscribe(EventType.GitCommitFailed, handleGitCommitFailedEvent),
    subscribe(EventType.GitCommitRolledBack, handleGitCommitRolledBackEvent),
    subscribe(EventType.GitPushed, handleGitPushedEvent),
    subscribe(EventType.GitPushFailed, handleGitPushFailedEvent),
    subscribe(EventType.TaskCompleted, handleTaskCompleted),
    subscribe(EventType.TaskFailed, handleTaskFailed),
    subscribe(EventType.LoopStopped, handleLoopEnd),
    subscribe(EventType.LoopFinished, handleLoopEnd),
  ];
}

/** Test-only: undo the bootstrap so tests can re-install a fresh set. */
export function teardownTaskStreamBootstrap(): void {
  for (const dispose of registeredDisposers) {
    try {
      dispose();
    } catch {
      // Disposer failures should not block further cleanup.
    }
  }
  registeredDisposers = [];
  isStreamingByTask.clear();
  bootstrapped = false;
}

export function peekIsTaskStreaming(taskId: string): boolean {
  return isStreamingByTask.get(taskId) ?? false;
}
