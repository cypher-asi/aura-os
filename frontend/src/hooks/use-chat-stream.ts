import { useRef, useState, useCallback } from "react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
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

function decodeBase64Text(base64: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function useChatStream({ projectId, chatSessionId }: UseChatStreamOptions) {
  const sidekick = useSidekick();
  const projectCtx = useProjectContext();
  const projectCtxRef = useRef(projectCtx);
  projectCtxRef.current = projectCtx;

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
  const pendingSpecIdsRef = useRef<string[]>([]);

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
              ...attachments.map((a) =>
                a.type === "text"
                  ? {
                      type: "text" as const,
                      text: `[File: ${a.name ?? "document"}]\n\n${decodeBase64Text(a.data)}`,
                    }
                  : { type: "image" as const, media_type: a.media_type, data: a.data },
              ),
            ]
          : undefined;

      const attachmentLabel =
        attachments && attachments.length > 0
          ? attachments.some((a) => a.type === "text")
            ? `[${attachments.length} file(s)]`
            : `[${attachments.length} image(s)]`
          : "";

      const userMsg: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || (action === "generate_specs" ? "Generate specs for this project" : trimmed) || attachmentLabel,
        contentBlocks,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      sidekick.setStreamingSessionId(chatSessionId);
      setStreamingText("");
      streamBufferRef.current = "";
      setThinkingText("");
      thinkingBufferRef.current = "";
      thinkingStartRef.current = null;
      setThinkingDurationMs(null);
      toolCallsRef.current = [];
      setActiveToolCalls([]);
      pendingSpecIdsRef.current = [];

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

            if (info.name === "create_spec" && projectId) {
              const pendingId = `pending-${info.id}`;
              const now = new Date().toISOString();
              sidekick.pushSpec({
                spec_id: pendingId,
                project_id: projectId,
                title: (info.input.title as string) || "Generating…",
                order_index: Date.now(),
                markdown_contents: (info.input.markdown_contents as string) || "",
                created_at: now,
                updated_at: now,
              });
              pendingSpecIdsRef.current.push(pendingId);
            }
          },
          onToolResult(info: ToolResultInfo) {
            toolCallsRef.current = toolCallsRef.current.map((tc) =>
              tc.id === info.id
                ? { ...tc, result: info.result, isError: info.is_error, pending: false }
                : tc,
            );
            setActiveToolCalls([...toolCallsRef.current]);

            if (info.name === "create_spec" && info.is_error) {
              const pendingId = `pending-${info.id}`;
              const idx = pendingSpecIdsRef.current.indexOf(pendingId);
              if (idx !== -1) {
                pendingSpecIdsRef.current.splice(idx, 1);
                sidekick.removeSpec(pendingId);
              }
            }
          },
          onSpecSaved(spec) {
            const pendingId = pendingSpecIdsRef.current.shift();
            if (pendingId) {
              sidekick.removeSpec(pendingId);
            }
            sidekick.pushSpec(spec);
          },
          onSpecsTitle(title) {
            const ctx = projectCtxRef.current;
            if (ctx) {
              ctx.setProject({ ...ctx.project, specs_title: title });
            }
          },
          onSpecsSummary(summary) {
            const ctx = projectCtxRef.current;
            if (ctx) {
              ctx.setProject({ ...ctx.project, specs_summary: summary });
            }
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
            setThinkingText("");
            thinkingBufferRef.current = "";
            thinkingStartRef.current = null;
            setThinkingDurationMs(null);
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
    setThinkingText("");
    thinkingBufferRef.current = "";
    thinkingStartRef.current = null;
    setThinkingDurationMs(null);
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
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  };
}
