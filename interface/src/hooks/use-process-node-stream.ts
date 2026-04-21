import { useEffect, useRef } from "react";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";
import {
  useStreamCore,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolResult,
  resetStreamBuffers,
  finalizeStream,
} from "./use-stream-core";
import {
  acquireSharedStreamSubscriptions,
  getThinkingDurationMs,
} from "./stream/store";

/**
 * Bridges native harness events (text_delta, thinking_delta, tool_use_start,
 * tool_call_snapshot, tool_result) into the shared stream store for a single
 * process node execution.
 *
 * Events are the same types emitted by agent chat and tasks -- just filtered
 * by `run_id` + `node_id` context fields instead of `session_id` or `task_id`.
 *
 * Subscription single-flighting: see `useTaskStream` for the motivation. We
 * acquire a refcounted shared subscription set per streamKey so concurrent
 * mounts of the same run/node pair register exactly one subscription per
 * EventType on the event store.
 */
export function useProcessNodeStream(
  runId: string | undefined,
  nodeId: string | undefined,
  isActive?: boolean,
): { streamKey: string } {
  const { key, refs, setters, abortRef } = useStreamCore(["process-node", runId, nodeId]);
  const subscribe = useEventStore((s) => s.subscribe);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    if (isActive && !isStreamingRef.current) {
      setters.setIsStreaming(true);
      isStreamingRef.current = true;
    }
  }, [isActive, setters]);

  useEffect(() => {
    if (!runId || !nodeId) return;

    const matchesCtx = (c: Record<string, unknown>) =>
      c.run_id === runId && c.node_id === nodeId;

    const release = acquireSharedStreamSubscriptions(key, () => [
      subscribe(EventType.ProcessNodeExecuted, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.run_id !== runId || c.node_id !== nodeId) return;
        const status = ((c.status as string) ?? "").toLowerCase();
        if (status.includes("running")) {
          resetStreamBuffers(refs, setters);
          setters.setIsStreaming(true);
          isStreamingRef.current = true;
        } else {
          finalizeStream(refs, setters, abortRef, isStreamingRef.current, {
            reason: status.includes("failed") ? "failed" : "completed",
          });
          isStreamingRef.current = false;
        }
      }),

      subscribe(EventType.TextDelta, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (!matchesCtx(c)) return;
        const text = (c.text as string) ?? "";
        if (text) handleTextDelta(refs, setters, getThinkingDurationMs(key), text);
      }),

      subscribe(EventType.ThinkingDelta, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (!matchesCtx(c)) return;
        const thinking = (c.thinking as string) ?? "";
        if (thinking) handleThinkingDelta(refs, setters, thinking);
      }),

      subscribe(EventType.ToolUseStart, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (!matchesCtx(c)) return;
        handleToolCallStarted(refs, setters, {
          id: (c.id as string) ?? crypto.randomUUID(),
          name: (c.name as string) ?? "unknown",
        });
      }),

      subscribe(EventType.ToolCallSnapshot, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (!matchesCtx(c)) return;
        handleToolCallSnapshot(refs, setters, {
          id: (c.id as string) ?? "",
          name: (c.name as string) ?? "unknown",
          input: (c.input as Record<string, unknown>) ?? {},
        });
      }),

      subscribe(EventType.ToolResult, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (!matchesCtx(c)) return;
        handleToolResult(refs, setters, {
          id: c.id as string | undefined,
          name: (c.name as string) ?? "unknown",
          result: (c.result as string) ?? "",
          is_error: (c.is_error as boolean) ?? false,
        });
      }),

      subscribe(EventType.ProcessRunCompleted, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.run_id !== runId) return;
        finalizeStream(refs, setters, abortRef, isStreamingRef.current, {
          reason: "completed",
        });
        isStreamingRef.current = false;
      }),

      subscribe(EventType.ProcessRunFailed, (e) => {
        const c = e.content as unknown as Record<string, unknown>;
        if (c.run_id !== runId) return;
        finalizeStream(refs, setters, abortRef, isStreamingRef.current, {
          reason: "failed",
          message: (c.error as string | undefined) ?? undefined,
        });
        isStreamingRef.current = false;
      }),
    ]);

    return release;
  }, [runId, nodeId, key, refs, setters, abortRef, subscribe]);

  return { streamKey: key };
}
