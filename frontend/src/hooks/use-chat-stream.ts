import { useRef, useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import type { ChatStreamCallbacks, ChatAttachment, ToolCallInfo, ToolResultInfo } from "../api/streams";
import type { Message } from "../types";

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

export interface ArtifactRef {
  kind: "task" | "spec";
  id: string;
  title: string;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEntry[];
  artifactRefs?: ArtifactRef[];
  contentBlocks?: DisplayContentBlockUnion[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
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
  agentInstanceId: string | undefined;
}

interface StreamCtx {
  projectId: string;
  sidekick: ReturnType<typeof useSidekick>;
  projectCtxRef: { current: ReturnType<typeof useProjectContext> };
  capturedThinkingDurationMs: number | null;
  capturedIsStreaming: boolean;
  streamBufferRef: { current: string };
  thinkingBufferRef: { current: string };
  thinkingStartRef: { current: number | null };
  thinkingRafRef: { current: number | null };
  rafRef: { current: number | null };
  toolCallsRef: { current: ToolCallEntry[] };
  needsSeparatorRef: { current: boolean };
  pendingSpecIdsRef: { current: string[] };
  pendingTaskIdsRef: { current: string[] };
  abortRef: { current: AbortController | null };
  setStreamingText: Dispatch<SetStateAction<string>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setThinkingDurationMs: Dispatch<SetStateAction<number | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
}

type StreamBufferState = Pick<StreamCtx,
  'streamBufferRef' | 'thinkingBufferRef' | 'thinkingStartRef' | 'toolCallsRef' |
  'setStreamingText' | 'setThinkingText' | 'setThinkingDurationMs' | 'setActiveToolCalls'
>;

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

function snapshotThinking(
  thinkingBufferRef: { current: string },
  thinkingStartRef: { current: number | null },
) {
  return {
    savedThinking: thinkingBufferRef.current || undefined,
    savedThinkingDuration: thinkingStartRef.current != null
      ? Date.now() - thinkingStartRef.current
      : null,
  };
}

function snapshotToolCalls(
  toolCallsRef: { current: ToolCallEntry[] },
): ToolCallEntry[] | undefined {
  return toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined;
}

function resetStreamBuffers(state: StreamBufferState) {
  state.setStreamingText("");
  state.streamBufferRef.current = "";
  state.setThinkingText("");
  state.thinkingBufferRef.current = "";
  state.thinkingStartRef.current = null;
  state.setThinkingDurationMs(null);
  state.toolCallsRef.current = [];
  state.setActiveToolCalls([]);
}

function buildContentBlocks(
  trimmed: string,
  attachments: ChatAttachment[] | undefined,
): DisplayContentBlockUnion[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return [
    ...(trimmed ? [{ type: "text" as const, text: trimmed }] : []),
    ...attachments.map((a) =>
      a.type === "text"
        ? {
            type: "text" as const,
            text: `[File: ${a.name ?? "document"}]\n\n${decodeBase64Text(a.data)}`,
          }
        : { type: "image" as const, media_type: a.media_type, data: a.data },
    ),
  ];
}

function buildAttachmentLabel(attachments: ChatAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  return attachments.some((a) => a.type === "text")
    ? `[${attachments.length} file(s)]`
    : `[${attachments.length} image(s)]`;
}

function pushPendingSpec(
  info: ToolCallInfo,
  projectId: string,
  sidekick: StreamCtx["sidekick"],
  pendingSpecIdsRef: { current: string[] },
) {
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

function pushPendingTask(
  info: ToolCallInfo,
  projectId: string,
  sidekick: StreamCtx["sidekick"],
  pendingTaskIdsRef: { current: string[] },
) {
  const pendingId = `pending-${info.id}`;
  const now = new Date().toISOString();
  sidekick.pushTask({
    task_id: pendingId,
    project_id: projectId,
    spec_id: (info.input.spec_id as string) || "",
    title: (info.input.title as string) || "Creating…",
    description: (info.input.description as string) || "",
    status: "pending",
    order_index: Date.now(),
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    live_output: "",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: now,
    updated_at: now,
  });
  pendingTaskIdsRef.current.push(pendingId);
}

function removePendingArtifact(
  infoId: string,
  pendingIdsRef: { current: string[] },
  removeFn: (id: string) => void,
) {
  const pendingId = `pending-${infoId}`;
  const idx = pendingIdsRef.current.indexOf(pendingId);
  if (idx !== -1) {
    pendingIdsRef.current.splice(idx, 1);
    removeFn(pendingId);
  }
}

function handleThinkingDelta(ctx: StreamCtx, text: string) {
  if (ctx.thinkingStartRef.current === null) {
    ctx.thinkingStartRef.current = Date.now();
  }
  ctx.thinkingBufferRef.current += text;
  if (ctx.thinkingRafRef.current === null) {
    ctx.thinkingRafRef.current = requestAnimationFrame(() => {
      ctx.thinkingRafRef.current = null;
      ctx.setThinkingText(ctx.thinkingBufferRef.current);
    });
  }
}

function handleDelta(ctx: StreamCtx, text: string) {
  if (ctx.thinkingStartRef.current !== null && ctx.capturedThinkingDurationMs === null) {
    ctx.setThinkingDurationMs(Date.now() - ctx.thinkingStartRef.current);
  }
  if (ctx.needsSeparatorRef.current && ctx.streamBufferRef.current.length > 0) {
    ctx.streamBufferRef.current += "\n\n";
    ctx.needsSeparatorRef.current = false;
  }
  ctx.streamBufferRef.current += text;
  if (ctx.rafRef.current === null) {
    ctx.rafRef.current = requestAnimationFrame(() => {
      ctx.rafRef.current = null;
      ctx.setStreamingText(ctx.streamBufferRef.current);
    });
  }
}

function handleToolCall(ctx: StreamCtx, info: ToolCallInfo) {
  const entry: ToolCallEntry = {
    id: info.id,
    name: info.name,
    input: info.input,
    pending: true,
  };
  ctx.toolCallsRef.current = [...ctx.toolCallsRef.current, entry];
  ctx.setActiveToolCalls([...ctx.toolCallsRef.current]);
  if (info.name === "create_spec" && ctx.projectId) {
    pushPendingSpec(info, ctx.projectId, ctx.sidekick, ctx.pendingSpecIdsRef);
  }
  if (info.name === "create_task" && ctx.projectId) {
    pushPendingTask(info, ctx.projectId, ctx.sidekick, ctx.pendingTaskIdsRef);
  }
}

function handleToolResult(ctx: StreamCtx, info: ToolResultInfo) {
  ctx.toolCallsRef.current = ctx.toolCallsRef.current.map((tc) =>
    tc.id === info.id
      ? { ...tc, result: info.result, isError: info.is_error, pending: false }
      : tc,
  );
  ctx.setActiveToolCalls([...ctx.toolCallsRef.current]);
  ctx.needsSeparatorRef.current = true;
  if (info.name === "create_spec" && info.is_error) {
    removePendingArtifact(info.id, ctx.pendingSpecIdsRef, (id) => ctx.sidekick.removeSpec(id));
  }
  if (info.name === "create_task" && info.is_error) {
    removePendingArtifact(info.id, ctx.pendingTaskIdsRef, (id) => ctx.sidekick.removeTask(id));
  }
}

function handleMessageSaved(ctx: StreamCtx, msg: Message) {
  const finalToolCalls = snapshotToolCalls(ctx.toolCallsRef);
  const savedThinking = msg.thinking || ctx.thinkingBufferRef.current || undefined;
  const savedThinkingDuration = msg.thinking_duration_ms
    ?? (ctx.thinkingStartRef.current != null ? Date.now() - ctx.thinkingStartRef.current : null);
  ctx.setMessages((prev) => [
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
  resetStreamBuffers(ctx);
}

function handleStreamError(ctx: StreamCtx, message: string) {
  console.error("Chat stream error:", message);
  if (isInsufficientCreditsError(message)) {
    dispatchInsufficientCredits();
  }
  if (ctx.streamBufferRef.current) {
    const { savedThinking, savedThinkingDuration } = snapshotThinking(
      ctx.thinkingBufferRef, ctx.thinkingStartRef,
    );
    ctx.setMessages((prev) => [
      ...prev,
      {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: ctx.streamBufferRef.current + `\n\n*Error: ${message}*`,
        toolCalls: snapshotToolCalls(ctx.toolCallsRef),
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
      },
    ]);
  }
  resetStreamBuffers(ctx);
}

function handleStreamDone(ctx: StreamCtx) {
  if (ctx.streamBufferRef.current && !ctx.capturedIsStreaming) {
    const { savedThinking, savedThinkingDuration } = snapshotThinking(
      ctx.thinkingBufferRef, ctx.thinkingStartRef,
    );
    ctx.setMessages((prev) => [
      ...prev,
      {
        id: `stream-${Date.now()}`,
        role: "assistant",
        content: ctx.streamBufferRef.current,
        toolCalls: snapshotToolCalls(ctx.toolCallsRef),
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
      },
    ]);
    ctx.setStreamingText("");
    ctx.streamBufferRef.current = "";
    ctx.toolCallsRef.current = [];
    ctx.setActiveToolCalls([]);
  }
  ctx.setThinkingText("");
  ctx.thinkingBufferRef.current = "";
  ctx.thinkingStartRef.current = null;
  ctx.setThinkingDurationMs(null);
  ctx.setIsStreaming(false);
  ctx.sidekick.setStreamingAgentInstanceId(null);
  ctx.abortRef.current = null;
}

function createStreamCallbacks(ctx: StreamCtx): ChatStreamCallbacks {
  return {
    onThinkingDelta: (text) => handleThinkingDelta(ctx, text),
    onDelta: (text) => handleDelta(ctx, text),
    onToolCall: (info) => handleToolCall(ctx, info),
    onToolResult: (info) => handleToolResult(ctx, info),
    onSpecSaved(spec) {
      const pendingId = ctx.pendingSpecIdsRef.current.shift();
      if (pendingId) ctx.sidekick.removeSpec(pendingId);
      ctx.sidekick.pushSpec(spec);
    },
    onSpecsTitle(title) {
      const pctx = ctx.projectCtxRef.current;
      if (pctx) pctx.setProject((prev) => ({ ...prev, specs_title: title }));
    },
    onSpecsSummary(summary) {
      const pctx = ctx.projectCtxRef.current;
      if (pctx) pctx.setProject((prev) => ({ ...prev, specs_summary: summary }));
    },
    onTaskSaved(task) {
      const pendingId = ctx.pendingTaskIdsRef.current.shift();
      if (pendingId) ctx.sidekick.removeTask(pendingId);
      ctx.sidekick.pushTask(task);
    },
    onMessageSaved: (msg) => handleMessageSaved(ctx, msg),
    onAgentInstanceUpdated: (instance) => ctx.sidekick.notifyAgentInstanceUpdate(instance),
    onTokenUsage() {},
    onError: (message) => handleStreamError(ctx, message),
    onDone: () => handleStreamDone(ctx),
  };
}

export function useChatStream({ projectId, agentInstanceId }: UseChatStreamOptions) {
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
  const needsSeparatorRef = useRef(false);
  const pendingSpecIdsRef = useRef<string[]>([]);
  const pendingTaskIdsRef = useRef<string[]>([]);

  const resetMessages = useCallback((msgs: DisplayMessage[]) => {
    setMessages(msgs);
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      _selectedModel?: string | null,
      attachments?: ChatAttachment[],
    ) => {
      if (!projectId || !agentInstanceId || isStreaming) return;
      const trimmed = content.trim();
      if (!trimmed && !action && !(attachments && attachments.length > 0)) return;

      const userMsg: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || (action === "generate_specs" ? "Generate specs for this project" : trimmed) || buildAttachmentLabel(attachments),
        contentBlocks: buildContentBlocks(trimmed, attachments),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      sidekick.setStreamingAgentInstanceId(agentInstanceId);

      const ctx: StreamCtx = {
        projectId: projectId!, sidekick, projectCtxRef,
        capturedThinkingDurationMs: thinkingDurationMs, capturedIsStreaming: isStreaming,
        streamBufferRef, thinkingBufferRef, thinkingStartRef, thinkingRafRef, rafRef,
        toolCallsRef, needsSeparatorRef, pendingSpecIdsRef, pendingTaskIdsRef, abortRef,
        setStreamingText, setThinkingText, setThinkingDurationMs, setActiveToolCalls,
        setMessages, setIsStreaming,
      };
      resetStreamBuffers(ctx);
      needsSeparatorRef.current = false;
      pendingSpecIdsRef.current = [];
      pendingTaskIdsRef.current = [];

      if (action === "generate_specs") {
        sidekick.clearGeneratedArtifacts();
        sidekick.setActiveTab("specs");
      }

      const controller = new AbortController();
      abortRef.current = controller;
      await api.sendMessageStream(
        projectId, agentInstanceId, userMsg.content, action, null,
        attachments, createStreamCallbacks(ctx), controller.signal,
      );
      setIsStreaming(false);
      sidekick.setStreamingAgentInstanceId(null);
      abortRef.current = null;
    },
    [projectId, agentInstanceId, isStreaming, sidekick],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (streamBufferRef.current) {
      const { savedThinking, savedThinkingDuration } = snapshotThinking(
        thinkingBufferRef, thinkingStartRef,
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant",
          content: streamBufferRef.current,
          toolCalls: snapshotToolCalls(toolCallsRef),
          thinkingText: savedThinking,
          thinkingDurationMs: savedThinkingDuration,
        },
      ]);
    }
    resetStreamBuffers({
      streamBufferRef, thinkingBufferRef, thinkingStartRef, toolCallsRef,
      setStreamingText, setThinkingText, setThinkingDurationMs, setActiveToolCalls,
    });
    setIsStreaming(false);
    sidekick.setStreamingAgentInstanceId(null);
    abortRef.current = null;

    if (projectId && agentInstanceId) {
      const refetch = () => {
        api.getAgentInstance(projectId, agentInstanceId).then((instance) => {
          sidekick.notifyAgentInstanceUpdate(instance);
        }).catch(() => {});
      };
      setTimeout(refetch, 2000);
      setTimeout(refetch, 5000);
    }
  }, [sidekick, projectId, agentInstanceId]);

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
