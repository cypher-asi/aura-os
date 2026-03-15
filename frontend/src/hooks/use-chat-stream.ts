import { useRef, useState, useCallback } from "react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import type { ToolCallInfo, ToolResultInfo } from "../api/streams";

export interface DisplayContentBlock {
  type: "text";
  text: string;
}

export interface DisplayImageBlock {
  type: "image";
  media_type: string;
  data: string;
}

export type DisplayContentBlockUnion = DisplayContentBlock | DisplayImageBlock;

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEntry[];
  contentBlocks?: DisplayContentBlockUnion[];
}

export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  pending: boolean;
}

interface UseChatStreamOptions {
  projectId: string | undefined;
  chatSessionId: string | undefined;
}

export function useChatStream({ projectId, chatSessionId }: UseChatStreamOptions) {
  const sidekick = useSidekick();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const toolCallsRef = useRef<ToolCallEntry[]>([]);

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
      if (!projectId || !chatSessionId || isStreaming) return;
      const trimmed = content.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if (!trimmed && !action && !hasAttachments) return;

      const contentBlocks: DisplayMessage["contentBlocks"] =
        attachments && attachments.length > 0
          ? [
              ...(trimmed ? [{ type: "text" as const, text: trimmed }] : []),
              ...attachments.map((a) => ({
                type: "image" as const,
                media_type: a.media_type,
                data: a.data,
              })),
            ]
          : undefined;

      const userMsg: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || (action === "generate_specs" ? "Generate specs for this project" : trimmed) || (attachments?.length ? `[${attachments.length} image(s)]` : ""),
        contentBlocks,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      sidekick.setStreamingSessionId(chatSessionId);
      setStreamingText("");
      streamBufferRef.current = "";
      toolCallsRef.current = [];
      setActiveToolCalls([]);

      if (action === "generate_specs") {
        sidekick.clearGeneratedArtifacts();
        sidekick.setActiveTab("specs");
      }

      const controller = new AbortController();
      abortRef.current = controller;

      await api.sendMessageStream(
        projectId,
        chatSessionId,
        userMsg.content,
        action,
        selectedModel,
        attachments,
        {
          onDelta(text) {
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
          },
          onSpecSaved(spec) {
            sidekick.pushSpec(spec);
          },
          onTaskSaved(task) {
            sidekick.pushTask(task);
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
            toolCallsRef.current = [];
            setActiveToolCalls([]);
          },
          onTitleUpdated(session) {
            sidekick.notifySessionTitleUpdate(session);
          },
          onError(message) {
            console.error("Chat stream error:", message);
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
            setIsStreaming(false);
            sidekick.setStreamingSessionId(null);
            abortRef.current = null;
          },
        },
        controller.signal,
      );

      setIsStreaming(false);
      sidekick.setStreamingSessionId(null);
      abortRef.current = null;
    },
    [projectId, chatSessionId, isStreaming, sidekick],
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
    toolCallsRef.current = [];
    setActiveToolCalls([]);
    setIsStreaming(false);
    sidekick.setStreamingSessionId(null);
    abortRef.current = null;
  }, [sidekick]);

  return {
    messages,
    isStreaming,
    streamingText,
    activeToolCalls,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  };
}
