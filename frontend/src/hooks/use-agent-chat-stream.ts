import { useRef, useState, useCallback } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../api/client";
import type { ToolCallInfo, ToolResultInfo } from "../api/streams";
import type { Message, Spec, Task } from "../types";
import type {
  DisplayMessage,
  ToolCallEntry,
} from "./use-chat-stream";

interface UseAgentChatStreamOptions {
  agentId: string | undefined;
  onTaskSaved?: (task: Task) => void;
  onSpecSaved?: (spec: Spec) => void;
}

interface StreamRefs {
  streamBuffer: MutableRefObject<string>;
  thinkingBuffer: MutableRefObject<string>;
  thinkingStart: MutableRefObject<number | null>;
  toolCalls: MutableRefObject<ToolCallEntry[]>;
  needsSeparator: MutableRefObject<boolean>;
  raf: MutableRefObject<number | null>;
  thinkingRaf: MutableRefObject<number | null>;
}

interface StreamSetters {
  setStreamingText: Dispatch<SetStateAction<string>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setThinkingDurationMs: Dispatch<SetStateAction<number | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
}

function snapshotThinking(refs: StreamRefs) {
  return {
    savedThinking: refs.thinkingBuffer.current || undefined,
    savedThinkingDuration: refs.thinkingStart.current != null
      ? Date.now() - refs.thinkingStart.current
      : null,
  };
}

function snapshotToolCalls(refs: StreamRefs): ToolCallEntry[] | undefined {
  return refs.toolCalls.current.length > 0
    ? [...refs.toolCalls.current]
    : undefined;
}

function resetStreamState(refs: StreamRefs, setters: StreamSetters) {
  setters.setStreamingText("");
  refs.streamBuffer.current = "";
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  refs.toolCalls.current = [];
  setters.setActiveToolCalls([]);
}

function handleThinkingDelta(
  text: string,
  refs: StreamRefs,
  setters: StreamSetters,
) {
  if (refs.thinkingStart.current === null) {
    refs.thinkingStart.current = Date.now();
  }
  refs.thinkingBuffer.current += text;
  if (refs.thinkingRaf.current === null) {
    refs.thinkingRaf.current = requestAnimationFrame(() => {
      refs.thinkingRaf.current = null;
      setters.setThinkingText(refs.thinkingBuffer.current);
    });
  }
}

function handleTextDelta(
  text: string,
  closureThinkingDurationMs: number | null,
  refs: StreamRefs,
  setters: StreamSetters,
) {
  if (refs.thinkingStart.current !== null && closureThinkingDurationMs === null) {
    setters.setThinkingDurationMs(Date.now() - refs.thinkingStart.current);
  }
  if (refs.needsSeparator.current && refs.streamBuffer.current.length > 0) {
    refs.streamBuffer.current += "\n\n";
    refs.needsSeparator.current = false;
  }
  refs.streamBuffer.current += text;
  if (refs.raf.current === null) {
    refs.raf.current = requestAnimationFrame(() => {
      refs.raf.current = null;
      setters.setStreamingText(refs.streamBuffer.current);
    });
  }
}

function handleToolCall(
  info: ToolCallInfo,
  refs: StreamRefs,
  setters: StreamSetters,
) {
  const entry: ToolCallEntry = {
    id: info.id,
    name: info.name,
    input: info.input,
    pending: true,
  };
  refs.toolCalls.current = [...refs.toolCalls.current, entry];
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

function handleToolResult(
  info: ToolResultInfo,
  refs: StreamRefs,
  setters: StreamSetters,
) {
  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.id === info.id
      ? { ...tc, result: info.result, isError: info.is_error, pending: false }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
  refs.needsSeparator.current = true;
}

function handleMessageSaved(
  msg: Message,
  refs: StreamRefs,
  setters: StreamSetters,
) {
  const finalToolCalls = snapshotToolCalls(refs);
  const savedThinking = msg.thinking || refs.thinkingBuffer.current || undefined;
  const savedThinkingDuration = msg.thinking_duration_ms
    ?? (refs.thinkingStart.current != null ? Date.now() - refs.thinkingStart.current : null);
  setters.setMessages((prev) => [
    ...prev,
    {
      id: msg.message_id,
      role: "assistant",
      content: msg.content,
      toolCalls: finalToolCalls,
      thinkingText: savedThinking,
      thinkingDurationMs: savedThinkingDuration,
    },
  ]);
  resetStreamState(refs, setters);
}

function handleStreamError(
  message: string,
  refs: StreamRefs,
  setters: StreamSetters,
) {
  console.error("Agent chat stream error:", message);
  if (isInsufficientCreditsError(message)) {
    dispatchInsufficientCredits();
  }
  const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
  const errorContent = refs.streamBuffer.current
    ? refs.streamBuffer.current + `\n\n*Error: ${message}*`
    : `*Error: ${message}*`;
  setters.setMessages((prev) => [
    ...prev,
    {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: errorContent,
      toolCalls: snapshotToolCalls(refs),
      thinkingText: savedThinking,
      thinkingDurationMs: savedThinkingDuration,
    },
  ]);
  resetStreamState(refs, setters);
}

function finalizeStream(
  refs: StreamRefs,
  setters: StreamSetters,
  abortRef: MutableRefObject<AbortController | null>,
  closureIsStreaming: boolean,
) {
  if (refs.streamBuffer.current && !closureIsStreaming) {
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    setters.setMessages((prev) => [
      ...prev,
      {
        id: `stream-${Date.now()}`,
        role: "assistant",
        content: refs.streamBuffer.current,
        toolCalls: snapshotToolCalls(refs),
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
      },
    ]);
    setters.setStreamingText("");
    refs.streamBuffer.current = "";
    refs.toolCalls.current = [];
    setters.setActiveToolCalls([]);
  }
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  setters.setIsStreaming(false);
  abortRef.current = null;
}

export function useAgentChatStream({ agentId, onTaskSaved, onSpecSaved }: UseAgentChatStreamOptions) {
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

  const refs: StreamRefs = {
    streamBuffer: streamBufferRef,
    thinkingBuffer: thinkingBufferRef,
    thinkingStart: thinkingStartRef,
    toolCalls: toolCallsRef,
    needsSeparator: needsSeparatorRef,
    raf: rafRef,
    thinkingRaf: thinkingRafRef,
  };

  const setters: StreamSetters = {
    setStreamingText,
    setThinkingText,
    setThinkingDurationMs,
    setActiveToolCalls,
    setMessages,
    setIsStreaming,
  };

  const resetMessages = useCallback((msgs: DisplayMessage[]) => {
    setMessages(msgs);
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      _selectedModel?: string | null,
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
      resetStreamState(refs, setters);
      needsSeparatorRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;

      await api.agents.sendMessageStream(
        agentId,
        userMsg.content,
        action,
        null,
        attachments,
        {
          onThinkingDelta: (text) => handleThinkingDelta(text, refs, setters),
          onDelta: (text) => handleTextDelta(text, thinkingDurationMs, refs, setters),
          onToolCall: (info) => handleToolCall(info, refs, setters),
          onToolResult: (info) => handleToolResult(info, refs, setters),
          onSpecSaved: (spec) => onSpecSaved?.(spec),
          onTaskSaved: (task) => onTaskSaved?.(task),
          onMessageSaved: (msg) => handleMessageSaved(msg, refs, setters),
          onTokenUsage() {},
          onError: (message) => handleStreamError(message, refs, setters),
          onDone: () => finalizeStream(refs, setters, abortRef, isStreaming),
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
      const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
      setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant",
          content: streamBufferRef.current,
          toolCalls: snapshotToolCalls(refs),
          thinkingText: savedThinking,
          thinkingDurationMs: savedThinkingDuration,
        },
      ]);
    }
    resetStreamState(refs, setters);
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
