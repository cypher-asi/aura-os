import { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import type { ChatAttachment, StreamEventHandler } from "../api/streams";
import type { Spec, Task } from "../types";
import type { AuraEvent } from "../types/aura-events";
import { EventType } from "../types/aura-events";
import { useChatHistoryStore, agentHistoryKey } from "../stores/chat-history-store";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  handleEventSaved,
  handleAssistantTurnBoundary,
  handleStreamError,
  finalizeStream,
  getIsStreaming,
  getThinkingDurationMs,
} from "./use-stream-core";
import type { DisplaySessionEvent } from "../types/stream";

interface UseAgentChatStreamOptions {
  agentId: string | undefined;
  onTaskSaved?: (task: Task) => void;
  onSpecSaved?: (spec: Spec) => void;
}

interface UseAgentChatStreamResult {
  streamKey: string;
  sendMessage: (
    content: string,
    action?: string | null,
    selectedModel?: string | null,
    attachments?: ChatAttachment[],
  ) => Promise<void>;
  stopStreaming: () => void;
  resetEvents: (msgs: DisplaySessionEvent[], options?: { allowWhileStreaming?: boolean }) => void;
}

export function useAgentChatStream({ agentId, onTaskSaved, onSpecSaved }: UseAgentChatStreamOptions): UseAgentChatStreamResult {
  const core = useStreamCore([agentId]);
  const { refs, setters, abortRef } = core;

  const onSpecSavedRef = useRef(onSpecSaved);
  useEffect(() => { onSpecSavedRef.current = onSpecSaved; }, [onSpecSaved]);

  const onTaskSavedRef = useRef(onTaskSaved);
  useEffect(() => { onTaskSavedRef.current = onTaskSaved; }, [onTaskSaved]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel?: string | null,
      attachments?: ChatAttachment[],
    ) => {
      if (!agentId || getIsStreaming(core.key)) return;
      const trimmed = content.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if (!trimmed && !action && !hasAttachments) return;

      const userMsg: DisplaySessionEvent = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || "",
      };

      core.setEvents((prev) => [...prev, userMsg]);
      core.setIsStreaming(true);
      resetStreamBuffers(refs, setters);
      refs.needsSeparator.current = false;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const handler: StreamEventHandler = {
        onEvent(event: AuraEvent) {
          switch (event.type) {
            case EventType.Delta:
            case EventType.TextDelta:
              handleTextDelta(refs, setters, getThinkingDurationMs(core.key), (event.content as { text: string }).text);
              break;
            case EventType.ThinkingDelta: {
              const tc = event.content as { text?: string; thinking?: string };
              handleThinkingDelta(refs, setters, tc.text ?? tc.thinking ?? "");
              break;
            }
            case EventType.Progress:
              core.setProgressText(event.content.stage);
              break;
            case EventType.ToolCallStarted:
            case EventType.ToolUseStart:
              handleToolCallStarted(refs, setters, event.content as { id: string; name: string });
              break;
            case EventType.ToolCallSnapshot:
              handleToolCallSnapshot(refs, setters, event.content);
              break;
            case EventType.ToolCall:
              handleToolCall(refs, setters, event.content);
              break;
            case EventType.ToolResult:
              handleToolResult(refs, setters, event.content as { id: string; name: string; result: string; is_error: boolean });
              break;
            case EventType.SpecSaved:
              onSpecSavedRef.current?.(event.content.spec);
              break;
            case EventType.TaskSaved:
              onTaskSavedRef.current?.(event.content.task);
              break;
            case EventType.MessageEnd:
              handleEventSaved(refs, setters, event.content.event);
              break;
            case EventType.AssistantMessageEnd: {
              handleAssistantTurnBoundary(refs, setters);
              const stopReason = (event.content as { stop_reason?: string }).stop_reason;
              if (stopReason !== "tool_use") {
                resetStreamBuffers(refs, setters);
                core.setIsStreaming(false);
              }
              break;
            }
            case EventType.AssistantMessageStart:
            case EventType.SessionReady:
            case EventType.TokenUsage:
              break;
            case EventType.Error:
              handleStreamError(refs, setters, event.content.message);
              break;
            case EventType.Done:
              finalizeStream(refs, setters, abortRef, false);
              break;
          }
        },
        onError: (message) => handleStreamError(refs, setters, message),
        onDone: () => finalizeStream(refs, setters, abortRef, false),
      };

      try {
        await api.agents.sendEventStream(
          agentId,
          userMsg.content,
          action,
          selectedModel,
          attachments,
          handler,
          controller.signal,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err instanceof Error ? err.message : String(err));
      } finally {
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          controller.abort();
          abortRef.current = null;
        }
        if (agentId) {
          useChatHistoryStore.getState().invalidateHistory(agentHistoryKey(agentId));
        }
      }
    },
    [agentId, core.key, refs, setters, abortRef, core.setEvents, core.setIsStreaming, core.setProgressText],
  );

  return {
    streamKey: core.key,
    sendMessage,
    stopStreaming: core.baseStopStreaming,
    resetEvents: core.resetEvents,
  };
}
