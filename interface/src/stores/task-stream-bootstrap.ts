import { EventType } from "../types/aura-events";
import type { AuraEvent, AuraEventOfType } from "../types/aura-events";
import { useEventStore, getTaskOutput } from "./event-store/index";
import { parseEventContent } from "../shared/utils/event-content";
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
  handleToolCallRetrying,
  handleToolCallFailed,
  handleAssistantTurnBoundary,
  resolveAbandonedPendingToolCalls,
  finalizeStream,
} from "../hooks/stream/handlers";
import { useTaskOutputPanelStore } from "./task-output-panel-store";
import { useTaskStatusStore } from "./task-status-store";
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

function handleTaskStarted(e: AuraEventOfType<typeof EventType.TaskStarted>): void {
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

  // Update the per-task status store so observers (sidekick preview,
  // RunTaskButton, etc.) flip into "in progress" without each
  // running its own duplicate WS subscription. A new run also
  // clears any previous failure reason so retried tasks don't
  // surface a stale banner from the prior attempt.
  const status = useTaskStatusStore.getState();
  status.setLiveStatus(taskId, "in_progress");
  status.setLiveFailReason(taskId, null);
  if (e.session_id) {
    status.setLiveSessionId(taskId, e.session_id);
  }
}

function handleTextDeltaEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const text = (c.text as string) ?? "";
  if (!text) return;
  const { key, refs, setters } = contextForTask(taskId);
  handleTextDelta(refs, setters, getThinkingDurationMs(key), text);
}

function handleThinkingDeltaEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const thinking = (c.thinking as string) ?? (c.text as string) ?? "";
  if (!thinking) return;
  const { refs, setters } = contextForTask(taskId);
  handleThinkingDelta(refs, setters, thinking);
}

function handleToolUseStartEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
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
  const c = parseEventContent(e);
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
  const c = parseEventContent(e);
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

/**
 * Route a `ToolCallRetrying` event (from aura-harness, see
 * `AgentLoopEvent::ToolCallRetrying`) into the per-task stream
 * reducers so any live tool card with the matching `tool_use_id`
 * flips into its "Writing retrying (n/max)…" state. Out-of-order
 * deliveries are tolerated — the reducer will create a pending
 * placeholder entry if the start event hasn't arrived yet.
 */
function handleToolCallRetryingEvent(
  e: AuraEventOfType<typeof EventType.ToolCallRetrying>,
): void {
  const c = e.content;
  const taskId = c.task_id ?? undefined;
  if (!taskId) return;
  const rawId = typeof c.tool_use_id === "string" ? c.tool_use_id.trim() : "";
  if (!rawId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolCallRetrying(refs, setters, {
    id: rawId,
    name: (typeof c.tool_name === "string" && c.tool_name) || "unknown",
    attempt: c.attempt,
    max_attempts: c.max_attempts,
    delay_ms: c.delay_ms,
    reason: c.reason ?? "",
  });
}

/**
 * Route a terminal `ToolCallFailed` event into the reducers. Reaching
 * the UI means both the harness-side streaming retry budget and the
 * server-side `TOOL_CALL_RETRY_BUDGET` gave up; the reducer marks the
 * card red and latches `retryExhausted` so the renderer can surface
 * "retried N/max — <reason>" instead of just "retrying…".
 */
function handleToolCallFailedEvent(
  e: AuraEventOfType<typeof EventType.ToolCallFailed>,
): void {
  const c = e.content;
  const taskId = c.task_id ?? undefined;
  if (!taskId) return;
  const rawId = typeof c.tool_use_id === "string" ? c.tool_use_id.trim() : "";
  if (!rawId) return;
  const { refs, setters } = contextForTask(taskId);
  handleToolCallFailed(refs, setters, {
    id: rawId,
    name: (typeof c.tool_name === "string" && c.tool_name) || "unknown",
    reason: c.reason ?? "",
  });
}

function handleAssistantMessageEndEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  handleAssistantTurnBoundary(refs, setters);
}

function handleProgressEvent(e: AuraEvent): void {
  const c = parseEventContent(e);
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const stage = (c.stage as string) ?? "";
  if (!stage) return;
  const { setters } = contextForTask(taskId);
  setters.setProgressText(stage);
}

function handleGitCommittedEvent(e: AuraEventOfType<typeof EventType.GitCommitted>): void {
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
  e: AuraEventOfType<typeof EventType.GitCommitFailed>,
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
  e: AuraEventOfType<typeof EventType.GitCommitRolledBack>,
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

function handleGitPushedEvent(e: AuraEventOfType<typeof EventType.GitPushed>): void {
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
  e: AuraEventOfType<typeof EventType.GitPushFailed>,
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

function handleTaskCompleted(e: AuraEventOfType<typeof EventType.TaskCompleted>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters, abortRef } = contextForTask(taskId);
  mergeBufferedOutput(taskId, refs.streamBuffer.current, e.project_id);
  finalizeStream(refs, setters, abortRef, isStreamingByTask.get(taskId) ?? false, {
    reason: "completed",
  });
  isStreamingByTask.delete(taskId);
  useTaskOutputPanelStore.getState().completeTask(taskId);
  useTaskStatusStore.getState().setLiveStatus(taskId, "done");
  snapshotTaskTurns(taskId, e.project_id);
}

function handleTaskFailed(e: AuraEventOfType<typeof EventType.TaskFailed>): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters, abortRef } = contextForTask(taskId);
  mergeBufferedOutput(taskId, refs.streamBuffer.current, e.project_id);
  // Mirror the fallback chain in `useTaskStatus`: some synthetic /
  // legacy failure payloads use `error` or `message` instead of the
  // canonical `reason` field. Without these fallbacks the sidekick
  // panel would show a red badge with no explanation.
  const raw = parseEventContent(e);
  const reason =
    (typeof raw.reason === "string" && raw.reason) ||
    (typeof raw.error === "string" && raw.error) ||
    (typeof raw.message === "string" && raw.message) ||
    null;
  finalizeStream(refs, setters, abortRef, isStreamingByTask.get(taskId) ?? false, {
    reason: "failed",
    message: reason ?? undefined,
  });
  isStreamingByTask.delete(taskId);
  useTaskOutputPanelStore.getState().failTask(taskId, reason);
  // Mirror the status into the per-task status store. A `null`
  // reason intentionally leaves the existing `liveFailReason`
  // untouched (matching the panel store's behaviour) so a synthetic
  // `task_failed` with no reason can't wipe out a real reason an
  // earlier event already recorded.
  const status = useTaskStatusStore.getState();
  status.setLiveStatus(taskId, "failed");
  if (reason) {
    status.setLiveFailReason(taskId, reason);
  }
  snapshotTaskTurns(taskId, e.project_id);
}

/**
 * Append an in-stream error card when the server's Definition-of-Done
 * gate rejects a `task_completed`. Without this, a run whose tool uses
 * all succeeded would silently flip to "failed" with no visible cause.
 *
 * We reuse the existing tool-result machinery so the entry renders with
 * the same red styling as git failure rows - the gate decision sits
 * between the last tool use and the terminal `task_failed` event in the
 * timeline, which is exactly where a user would look for an explanation.
 */
function handleTaskCompletionGateEvent(
  e: AuraEventOfType<typeof EventType.TaskCompletionGate>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  if (e.content.passed) return;
  const { refs, setters } = contextForTask(taskId);
  const id = crypto.randomUUID();
  const reason =
    (typeof e.content.failure_reason === "string" && e.content.failure_reason) ||
    "Completion-validation gate rejected this task";
  const evidence = [
    `files ${e.content.n_files_changed}`,
    `build ${e.content.n_build_steps}`,
    `test ${e.content.n_test_steps}`,
    `fmt ${e.content.n_format_steps}`,
    `lint ${e.content.n_lint_steps}`,
    e.content.has_rust_change
      ? "rust"
      : e.content.has_source_change
        ? "source"
        : "docs",
  ].join(" · ");
  handleToolCallStarted(refs, setters, { id, name: "completion_gate_rejected" });
  handleToolResult(refs, setters, {
    id,
    name: "completion_gate_rejected",
    result: `${reason}\n${evidence}`,
    is_error: true,
  });
}

/**
 * Resolve stale pending tool-call cards when the dev loop retries a
 * task after a transient infra failure. Without this, every attempt's
 * `tool_use_start` stacks a fresh "Writing code…" card while the
 * previous attempt's card is stuck in the pending state forever —
 * exactly the "it just keeps saying writing code, but doesn't provide
 * any more details" pattern users saw during `Internal server error`
 * retry storms.
 *
 * We mark the old cards as errored with the retry reason so the panel
 * shows a red "Interrupted by upstream error" row, then the new
 * attempt's tool_use_start events continue to land normally and render
 * below it.
 */
function handleTaskRetryingEvent(
  e: AuraEventOfType<typeof EventType.TaskRetrying>,
): void {
  const taskId = e.content.task_id;
  if (!taskId) return;
  const { refs, setters } = contextForTask(taskId);
  resolveAbandonedPendingToolCalls(
    refs,
    setters,
    e.content.reason ?? "retrying after upstream error",
  );
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
    subscribe(EventType.ToolCallRetrying, handleToolCallRetryingEvent),
    subscribe(EventType.ToolCallFailed, handleToolCallFailedEvent),
    subscribe(EventType.AssistantMessageEnd, handleAssistantMessageEndEvent),
    subscribe(EventType.Progress, handleProgressEvent),
    subscribe(EventType.GitCommitted, handleGitCommittedEvent),
    subscribe(EventType.GitCommitFailed, handleGitCommitFailedEvent),
    subscribe(EventType.GitCommitRolledBack, handleGitCommitRolledBackEvent),
    subscribe(EventType.GitPushed, handleGitPushedEvent),
    subscribe(EventType.GitPushFailed, handleGitPushFailedEvent),
    subscribe(EventType.TaskCompleted, handleTaskCompleted),
    subscribe(EventType.TaskCompletionGate, handleTaskCompletionGateEvent),
    subscribe(EventType.TaskRetrying, handleTaskRetryingEvent),
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
