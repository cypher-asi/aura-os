import { useRef, useState, useCallback } from "react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../api/client";
import type { ToolCallInfo, ToolResultInfo } from "../api/streams";
import type {
  DisplayMessage,
  ToolCallEntry,
} from "./use-chat-stream";

interface UseAgentChatStreamOptions {
  agentId: string | undefined;
}

export function useAgentChatStream({ agentId }: UseAgentChatStreamOptions) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const thinkingBufferRef = useRef("");
  const thinkingRafRef = useRef<number | null>(null);
  const thinkingStartRef = useRef<number | null>(null);
  const toolCallsRef = useRef<ToolCallEntry[]>([]);
  const needsSeparatorRef = useRef(false);

  const resetMessages = useCallback((msgs: DisplayMessage[]) => {
    setMessages(msgs);
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel: string,
      attachments?: import("../api/streams").ChatAttachment[],
    ) => {
      if (!agentId || isStreaming) return;
      const trimmed = content.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if (!trimmed && !action && !hasAttachments) return;

      const userMsg: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || "",
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingText("");
      streamBufferRef.current = "";
      setThinkingText("");
      thinkingBufferRef.current = "";
      thinkingStartRef.current = null;
      setThinkingDurationMs(null);
      toolCallsRef.current = [];
      setActiveToolCalls([]);
      needsSeparatorRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;

      await api.agents.sendMessageStream(
        agentId,
        userMsg.content,
        action,
        selectedModel,
        attachments,
        {
          onThinkingDelta(text) {
            if (thinkingStartRef.current === null) {
              thinkingStartRef.current = Date.now();
            }
            thinkingBufferRef.current += text;
            if (thinkingRafRef.current === null) {
              thinkingRafRef.current = requestAnimationFrame(() => {
                thinkingRafRef.current = null;
                setThinkingText(thinkingBufferRef.current);
              });
            }
          },
          onDelta(text) {
            if (thinkingStartRef.current !== null && thinkingDurationMs === null) {
              setThinkingDurationMs(Date.now() - thinkingStartRef.current);
            }
            if (needsSeparatorRef.current && streamBufferRef.current.length > 0) {
              streamBufferRef.current += "\n\n";
              needsSeparatorRef.current = false;
            }
            streamBufferRef.current += text;
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                setStreamingText(streamBufferRef.current);
              });
            }
          },
          onToolCall(info: ToolCallInfo) {
            const entry: ToolCallEntry = {
              id: info.id,
              name: info.name,
              input: info.input,
              pending: true,
            };
            toolCallsRef.current = [...toolCallsRef.current, entry];
            setActiveToolCalls([...toolCallsRef.current]);
          },
          onToolResult(info: ToolResultInfo) {
            toolCallsRef.current = toolCallsRef.current.map((tc) =>
              tc.id === info.id
                ? { ...tc, result: info.result, isError: info.is_error, pending: false }
                : tc,
            );
            setActiveToolCalls([...toolCallsRef.current]);
            needsSeparatorRef.current = true;
          },
          onMessageSaved(msg) {
            const finalToolCalls = toolCallsRef.current.length > 0
              ? [...toolCallsRef.current]
              : undefined;
            setMessages((prev) => [
              ...prev,
              {
                id: msg.message_id,
                role: "assistant",
                content: msg.content,
                toolCalls: finalToolCalls,
              },
            ]);
            setStreamingText("");
            streamBufferRef.current = "";
            setThinkingText("");
            thinkingBufferRef.current = "";
            thinkingStartRef.current = null;
            setThinkingDurationMs(null);
            toolCallsRef.current = [];
            setActiveToolCalls([]);
          },
          onTokenUsage() {},
          onError(message) {
            console.error("Agent chat stream error:", message);
            if (isInsufficientCreditsError(message)) {
              dispatchInsufficientCredits();
            }
            if (streamBufferRef.current) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}`,
                  role: "assistant",
                  content: streamBufferRef.current + `\n\n*Error: ${message}*`,
                  toolCalls: toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
                },
              ]);
            }
            setStreamingText("");
            streamBufferRef.current = "";
            setThinkingText("");
            thinkingBufferRef.current = "";
            thinkingStartRef.current = null;
            setThinkingDurationMs(null);
            toolCallsRef.current = [];
            setActiveToolCalls([]);
          },
          onDone() {
            if (streamBufferRef.current && !isStreaming) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `stream-${Date.now()}`,
                  role: "assistant",
                  content: streamBufferRef.current,
                  toolCalls: toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
                },
              ]);
              setStreamingText("");
              streamBufferRef.current = "";
              toolCallsRef.current = [];
              setActiveToolCalls([]);
            }
            setThinkingText("");
            thinkingBufferRef.current = "";
            thinkingStartRef.current = null;
            setThinkingDurationMs(null);
            setIsStreaming(false);
            abortRef.current = null;
          },
        },
        controller.signal,
      );

      setIsStreaming(false);
      abortRef.current = null;
    },
    [agentId, isStreaming],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (streamBufferRef.current) {
      setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant",
          content: streamBufferRef.current,
          toolCalls: toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
        },
      ]);
    }
    setStreamingText("");
    streamBufferRef.current = "";
    setThinkingText("");
    thinkingBufferRef.current = "";
    thinkingStartRef.current = null;
    setThinkingDurationMs(null);
    toolCallsRef.current = [];
    setActiveToolCalls([]);
    setIsStreaming(false);
    abortRef.current = null;
  }, []);

  return {
    messages,
    isStreaming,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  };
}
