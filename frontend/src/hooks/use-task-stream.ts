import { useEffect, useRef } from "react";
import { useEventStore } from "../stores/event-store";
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

function debugTaskStreamLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b85524",
    },
    body: JSON.stringify({
      sessionId: "b85524",
      runId: "initial",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

/**
 * Bridges global WebSocket task events into the shared stream store,
 * reusing the same handlers and rendering path as the chat UI.
 */
export function useTaskStream(taskId: string | undefined): { streamKey: string } {
  const { key, refs, setters, abortRef } = useStreamCore(["task", taskId]);
  const subscribe = useEventStore((s) => s.subscribe);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    if (!taskId) return;

    const unsubs = [
      subscribe(EventType.TaskStarted, (e) => {
        debugTaskStreamLog("H3", "use-task-stream.ts:52", "TaskStarted seen by subscription", {
          subscribedTaskId: taskId,
          eventTaskId: e.content.task_id,
          streamKey: key,
        });
        if (e.content.task_id !== taskId) return;
        resetStreamBuffers(refs, setters);
        setters.setIsStreaming(true);
        isStreamingRef.current = true;
      }),

      subscribe(EventType.TextDelta, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        debugTaskStreamLog("H3", "use-task-stream.ts:63", "TextDelta seen by subscription", {
          subscribedTaskId: taskId,
          eventTaskId: (c.task_id as string | undefined) ?? null,
          streamKey: key,
          hasText: typeof c.text === "string" && (c.text as string).length > 0,
        });
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
        finalizeStream(refs, setters, abortRef, isStreamingRef.current);
        isStreamingRef.current = false;
      }),

      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id !== taskId) return;
        finalizeStream(refs, setters, abortRef, isStreamingRef.current);
        isStreamingRef.current = false;
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [taskId, key, refs, setters, abortRef, subscribe]);

  return { streamKey: key };
}
