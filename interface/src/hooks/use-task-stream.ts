import { useEffect, useRef } from "react";
import { useEventStore, getTaskOutput } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";
import {
  useStreamCore,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolResult,
  handleAssistantTurnBoundary,
  resetStreamBuffers,
  finalizeStream,
} from "./use-stream-core";
import {
  acquireSharedStreamSubscriptions,
  getThinkingDurationMs,
} from "./stream/store";

/**
 * Bridges global WebSocket task events into the shared stream store,
 * reusing the same handlers and rendering path as the chat UI.
 *
 * Pass `isActive` so the hook can eagerly set `isStreaming` when the task
 * is already in-progress on mount, avoiding the race where the
 * `TaskStarted` WS event fires before the subscription is registered.
 *
 * Subscription single-flighting: a single task (same `taskId`) is often
 * rendered in multiple places concurrently (e.g. `TaskPreview` in the
 * chat row AND `ActiveTaskStream` in the sidekick Run tab, or the two
 * `ActiveTaskStream` branches inside `TaskOutputPanel`). Without a
 * shared registry each mount independently subscribes to the same
 * `EventType`s on the event store, and each callback writes into the
 * same streamKey-scoped refs — so one backend `tool_use_start` produces
 * N duplicate tool cards. We acquire/release a refcounted shared
 * subscription set per streamKey so exactly one subscription per
 * EventType is registered regardless of how many components mount.
 */
export function useTaskStream(taskId: string | undefined, isActive?: boolean): { streamKey: string } {
  const { key, refs, setters, abortRef } = useStreamCore(["task", taskId]);
  const subscribe = useEventStore((s) => s.subscribe);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    if (isActive && !isStreamingRef.current) {
      setters.setIsStreaming(true);
      isStreamingRef.current = true;
    }
  }, [isActive, setters]);

  // Defensive finalize: if the task transitions out of an active state
  // (typically because the canonical status became `done` or `failed`)
  // while the streaming ref is still live, force-clear the streaming
  // state. Without this, a server-side failure that fails to emit a
  // `TaskFailed` WS event (e.g. stream closed, legacy synthetic
  // payloads) leaves the UI stuck showing "Putting it all together..."
  // indefinitely. The backend now also synthesizes proper `TaskFailed`
  // events in those cases, but this guard stays as a belt-and-braces
  // last line of defence against any remaining ways an indicator could
  // get stuck.
  useEffect(() => {
    if (isActive) return;
    if (!isStreamingRef.current) return;
    finalizeStream(refs, setters, abortRef, isStreamingRef.current, {
      reason: "failed",
    });
    isStreamingRef.current = false;
  }, [isActive, refs, setters, abortRef]);

  useEffect(() => {
    if (!taskId) return;

    const release = acquireSharedStreamSubscriptions(key, () => [
      subscribe(EventType.TaskStarted, (e) => {
        if (e.content.task_id !== taskId) return;
        resetStreamBuffers(refs, setters);
        setters.setIsStreaming(true);
        isStreamingRef.current = true;
      }),

      subscribe(EventType.TextDelta, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        const text = (c.text as string) ?? "";
        if (text) handleTextDelta(refs, setters, getThinkingDurationMs(key), text);
      }),

      subscribe(EventType.ThinkingDelta, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        const thinking = (c.thinking as string) ?? (c.text as string) ?? "";
        if (thinking) handleThinkingDelta(refs, setters, thinking);
      }),

      subscribe(EventType.ToolUseStart, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        const rawId = typeof c.id === "string" ? c.id.trim() : "";
        handleToolCallStarted(refs, setters, {
          id: rawId || crypto.randomUUID(),
          name: (typeof c.name === "string" && c.name) || "unknown",
        });
      }),

      subscribe(EventType.ToolCallSnapshot, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        // Drop snapshots with no id: they would otherwise create an orphan
        // pending tool call that never resolves and leaves the streaming
        // banner stuck on "Working..." after the run finishes.
        const rawId = typeof c.id === "string" ? c.id.trim() : "";
        if (!rawId) return;
        handleToolCallSnapshot(refs, setters, {
          id: rawId,
          name: (typeof c.name === "string" && c.name) || "unknown",
          input: (c.input as Record<string, unknown>) ?? {},
        });
      }),

      subscribe(EventType.ToolResult, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        handleToolResult(refs, setters, {
          id: c.id as string | undefined,
          name: (c.name as string) ?? "unknown",
          result: (c.result as string) ?? "",
          is_error: (c.is_error as boolean) ?? false,
        });
      }),

      subscribe(EventType.AssistantMessageEnd, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        handleAssistantTurnBoundary(refs, setters);
      }),

      subscribe(EventType.Progress, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.task_id !== taskId) return;
        const stage = (c.stage as string) ?? "";
        if (stage) setters.setProgressText(stage);
      }),

      subscribe(EventType.GitCommitted, (e) => {
        const c = e.content;
        if (c.task_id !== taskId) return;
        const id = crypto.randomUUID();
        const sha = c.commit_sha?.slice(0, 7) ?? "";
        handleToolCallStarted(refs, setters, { id, name: "git_commit" });
        handleToolResult(refs, setters, {
          id,
          name: "git_commit",
          result: sha ? `Committed ${sha}` : "Committed",
          is_error: false,
        });
      }),

      subscribe(EventType.GitCommitFailed, (e) => {
        const c = e.content;
        if (c.task_id !== taskId) return;
        const id = crypto.randomUUID();
        handleToolCallStarted(refs, setters, { id, name: "git_commit" });
        handleToolResult(refs, setters, {
          id,
          name: "git_commit",
          result: c.reason ?? "Commit failed",
          is_error: true,
        });
      }),

      subscribe(EventType.GitPushed, (e) => {
        const c = e.content;
        if (c.task_id !== taskId) return;
        const id = crypto.randomUUID();
        const count = c.commits?.length ?? 0;
        const branch = c.branch ?? "main";
        handleToolCallStarted(refs, setters, { id, name: "git_push" });
        handleToolResult(refs, setters, {
          id,
          name: "git_push",
          result: `Pushed ${count} commit${count !== 1 ? "s" : ""} to ${branch}`,
          is_error: false,
        });
      }),

      subscribe(EventType.GitPushFailed, (e) => {
        const c = e.content;
        if (c.task_id !== taskId) return;
        const id = crypto.randomUUID();
        handleToolCallStarted(refs, setters, { id, name: "git_push" });
        handleToolResult(refs, setters, {
          id,
          name: "git_push",
          result: c.reason ?? "Push failed",
          is_error: true,
        });
      }),

      subscribe(EventType.TaskCompleted, (e) => {
        if (e.content.task_id !== taskId) return;
        const bufferedText = refs.streamBuffer.current;
        if (bufferedText) {
          const existingText = getTaskOutput(taskId).text;
          const mergedText = existingText.endsWith(bufferedText)
            ? existingText
            : `${existingText}${bufferedText}`;
          if (mergedText && mergedText !== existingText) {
            useEventStore.getState().seedTaskOutput(taskId, mergedText, undefined, undefined, e.project_id);
          }
        }
        finalizeStream(refs, setters, abortRef, isStreamingRef.current, {
          reason: "completed",
        });
        isStreamingRef.current = false;
      }),

      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id !== taskId) return;
        const bufferedText = refs.streamBuffer.current;
        if (bufferedText) {
          const existingText = getTaskOutput(taskId).text;
          const mergedText = existingText.endsWith(bufferedText)
            ? existingText
            : `${existingText}${bufferedText}`;
          if (mergedText && mergedText !== existingText) {
            useEventStore.getState().seedTaskOutput(taskId, mergedText, undefined, undefined, e.project_id);
          }
        }
        finalizeStream(refs, setters, abortRef, isStreamingRef.current, {
          reason: "failed",
          message: e.content.reason ?? undefined,
        });
        isStreamingRef.current = false;
      }),
    ]);

    return release;
  }, [taskId, key, refs, setters, abortRef, subscribe]);

  return { streamKey: key };
}
