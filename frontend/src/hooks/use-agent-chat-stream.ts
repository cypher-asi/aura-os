import { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import type { ChatAttachment } from "../api/streams";
import type { Spec, Task } from "../types";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCall,
  handleToolResult,
  handleMessageSaved,
  handleStreamError,
  finalizeStream,
} from "./use-stream-core";
import type { DisplayMessage } from "../types/stream";

interface UseAgentChatStreamOptions {
  agentId: string | undefined;
  onTaskSaved?: (task: Task) => void;
  onSpecSaved?: (spec: Spec) => void;
}

export function useAgentChatStream({ agentId, onTaskSaved, onSpecSaved }: UseAgentChatStreamOptions) {
  const core = useStreamCore([agentId]);
  const { refs, setters, abortRef, isStreamingRef, thinkingDurationMsRef } = core;

  const onSpecSavedRef = useRef(onSpecSaved);
  useEffect(() => { onSpecSavedRef.current = onSpecSaved; }, [onSpecSaved]);

  const onTaskSavedRef = useRef(onTaskSaved);
  useEffect(() => { onTaskSavedRef.current = onTaskSaved; }, [onTaskSaved]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      _selectedModel?: string | null,
      attachments?: ChatAttachment[],
    ) => {
      if (!agentId || isStreamingRef.current) return;
      const trimmed = content.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if (!trimmed && !action && !hasAttachments) return;

      const userMsg: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || "",
      };

      core.setMessages((prev) => [...prev, userMsg]);
      core.setIsStreaming(true);
      resetStreamBuffers(refs, setters);
      refs.needsSeparator.current = false;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await api.agents.sendMessageStream(
          agentId,
          userMsg.content,
          action,
          null,
          attachments,
          {
            onProgress: (stage) => core.setProgressText(stage),
            onThinkingDelta: (text) => handleThinkingDelta(refs, setters, text),
            onDelta: (text) => handleTextDelta(refs, setters, thinkingDurationMsRef.current, text),
            onToolCallStarted: (info) => handleToolCallStarted(refs, setters, info),
            onToolCall: (info) => handleToolCall(refs, setters, info),
            onToolResult: (info) => handleToolResult(refs, setters, info),
            onSpecSaved: (spec) => onSpecSavedRef.current?.(spec),
            onTaskSaved: (task) => onTaskSavedRef.current?.(task),
            onMessageSaved: (msg) => handleMessageSaved(refs, setters, msg),
            onTokenUsage() {},
            onError: (message) => handleStreamError(refs, setters, message),
            onDone: () => finalizeStream(refs, setters, abortRef, isStreamingRef.current),
          },
          controller.signal,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err instanceof Error ? err.message : String(err));
      } finally {
        core.setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [agentId],
  );

  return {
    messages: core.messages,
    isStreaming: core.isStreaming,
    streamingText: core.streamingText,
    thinkingText: core.thinkingText,
    thinkingDurationMs: core.thinkingDurationMs,
    activeToolCalls: core.activeToolCalls,
    progressText: core.progressText,
    sendMessage,
    stopStreaming: core.baseStopStreaming,
    resetMessages: core.resetMessages,
    rafRef: core.rafRef,
  };
}
