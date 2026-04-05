import { useEffect, useRef } from "react";
import { useEventStore, getTaskOutput } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";
import {
  useStreamCore,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolResult,
  handleAssistantTurnBoundary,
  resetStreamBuffers,
  finalizeStream,
} from "./use-stream-core";
import { getThinkingDurationMs } from "./stream/store";

/**
 * Bridges global WebSocket task events into the shared stream store,
 * reusing the same handlers and rendering path as the chat UI.
 *
 * Pass `isActive` so the hook can eagerly set `isStreaming` when the task
 * is already in-progress on mount, avoiding the race where the
 * `TaskStarted` WS event fires before the subscription is registered.
 */
export function useTaskStream(taskId: string | undefined, isActive?: boolean): { streamKey: string } {
  const { key, refs, setters, abortRef } = useStreamCore(["task", taskId]);
  const subscribe = useEventStore((s) => s.subscribe);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    if (!taskId) return;

    if (isActive && !isStreamingRef.current) {
      setters.setIsStreaming(true);
      isStreamingRef.current = true;
    }

    const unsubs = [
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
        handleToolCallStarted(refs, setters, {
          id: (c.id as string) ?? crypto.randomUUID(),
          name: (c.name as string) ?? "unknown",
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
        finalizeStream(refs, setters, abortRef, isStreamingRef.current);
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
        finalizeStream(refs, setters, abortRef, isStreamingRef.current);
        isStreamingRef.current = false;
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [taskId, isActive, key, refs, setters, abortRef, subscribe]);

  return { streamKey: key };
}
