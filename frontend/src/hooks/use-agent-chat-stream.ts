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
  handleToolCallDelta,
  handleToolCall,
  handleToolResult,
  handleMessageSaved,
  handleStreamError,
  finalizeStream,
  getIsStreaming,
  getThinkingDurationMs,
} from "./use-stream-core";
import type { DisplayMessage } from "../types/stream";

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
  resetMessages: (msgs: DisplayMessage[], options?: { allowWhileStreaming?: boolean }) => void;
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
      _selectedModel?: string | null,
      attachments?: ChatAttachment[],
    ) => {
      if (!agentId || getIsStreaming(core.key)) return;
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
            onDelta: (text) => handleTextDelta(refs, setters, getThinkingDurationMs(core.key), text),
            onToolCallStarted: (info) => handleToolCallStarted(refs, setters, info),
            onToolCallDelta: (info) => handleToolCallDelta(refs, setters, info),
            onToolCall: (info) => handleToolCall(refs, setters, info),
            onToolResult: (info) => handleToolResult(refs, setters, info),
            onSpecSaved: (spec) => onSpecSavedRef.current?.(spec),
            onTaskSaved: (task) => onTaskSavedRef.current?.(task),
            onMessageSaved: (msg) => handleMessageSaved(refs, setters, msg),
            onTokenUsage() {},
            onError: (message) => handleStreamError(refs, setters, message),
            onDone: () => finalizeStream(refs, setters, abortRef, getIsStreaming(core.key)),
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
    [agentId, core.key, refs, setters, abortRef, core.setMessages, core.setIsStreaming, core.setProgressText],
  );

  return {
    streamKey: core.key,
    sendMessage,
    stopStreaming: core.baseStopStreaming,
    resetMessages: core.resetMessages,
  };
}
