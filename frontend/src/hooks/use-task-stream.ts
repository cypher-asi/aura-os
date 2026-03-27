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
