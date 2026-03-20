import { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import type { ChatStreamCallbacks, ChatAttachment, ToolCallInfo } from "../api/streams";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCall as coreHandleToolCall,
  handleToolResult as coreHandleToolResult,
  handleMessageSaved,
  handleStreamError,
  finalizeStream,
} from "./use-stream-core";

export type {
  DisplayContentBlock,
  DisplayImageBlock,
  DisplayContentBlockUnion,
  ArtifactRef,
  DisplayMessage,
  ToolCallEntry,
} from "./use-stream-core";

import type { DisplayContentBlockUnion } from "./use-stream-core";

interface UseChatStreamOptions {
  projectId: string | undefined;
  agentInstanceId: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  Attachment helpers (unique to project chat)                        */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Optimistic artifact helpers (unique to project chat)               */
/* ------------------------------------------------------------------ */

function pushPendingSpec(
  info: ToolCallInfo,
  projectId: string,
  sidekick: ReturnType<typeof useSidekick>,
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
  sidekick: ReturnType<typeof useSidekick>,
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

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useChatStream({ projectId, agentInstanceId }: UseChatStreamOptions) {
  const sidekick = useSidekick();
  const sidekickRef = useRef(sidekick);
  const projectCtx = useProjectContext();
  const projectCtxRef = useRef(projectCtx);

  useEffect(() => { sidekickRef.current = sidekick; }, [sidekick]);
  useEffect(() => { projectCtxRef.current = projectCtx; }, [projectCtx]);

  const core = useStreamCore([projectId, agentInstanceId]);
  const { refs, setters, abortRef, isStreamingRef, thinkingDurationMsRef } = core;

  const pendingSpecIdsRef = useRef<string[]>([]);
  const pendingTaskIdsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      if (!core.isStreamingRef.current) {
        sidekickRef.current.setStreamingAgentInstanceId(null);
      }
    };
  }, [projectId, agentInstanceId, core.isStreamingRef]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      _selectedModel?: string | null,
      attachments?: ChatAttachment[],
    ) => {
      if (!projectId || !agentInstanceId || isStreamingRef.current) return;
      const trimmed = content.trim();
      if (!trimmed && !action && !(attachments && attachments.length > 0)) return;

      const userMsg = {
        id: `temp-${Date.now()}`,
        role: "user" as const,
        content: trimmed || (action === "generate_specs" ? "Generate specs for this project" : trimmed) || buildAttachmentLabel(attachments),
        contentBlocks: buildContentBlocks(trimmed, attachments),
      };
      core.setMessages((prev) => [...prev, userMsg]);
      core.setIsStreaming(true);
      sidekickRef.current.setStreamingAgentInstanceId(agentInstanceId);

      resetStreamBuffers(refs, setters);
      refs.needsSeparator.current = false;
      pendingSpecIdsRef.current = [];
      pendingTaskIdsRef.current = [];

      if (action === "generate_specs") {
        sidekickRef.current.clearGeneratedArtifacts();
        sidekickRef.current.setActiveTab("specs");
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const callbacks: ChatStreamCallbacks = {
        onProgress: (stage) => core.setProgressText(stage),
        onThinkingDelta: (text) => handleThinkingDelta(refs, setters, text),
        onDelta: (text) => handleTextDelta(refs, setters, thinkingDurationMsRef.current, text),
        onToolCallStarted: (info) => handleToolCallStarted(refs, setters, info),
        onToolCall: (info) => {
          coreHandleToolCall(refs, setters, info);
          if (info.name === "create_spec" && projectId) {
            pushPendingSpec(info, projectId, sidekickRef.current, pendingSpecIdsRef);
          }
          if (info.name === "create_task" && projectId) {
            pushPendingTask(info, projectId, sidekickRef.current, pendingTaskIdsRef);
          }
        },
        onToolResult: (info) => {
          coreHandleToolResult(refs, setters, info);
          if (info.name === "create_spec" && info.is_error) {
            removePendingArtifact(info.id, pendingSpecIdsRef, (id) => sidekickRef.current.removeSpec(id));
          }
          if (info.name === "create_task" && info.is_error) {
            removePendingArtifact(info.id, pendingTaskIdsRef, (id) => sidekickRef.current.removeTask(id));
          }
          if (info.name === "delete_spec" && !info.is_error) {
            try {
              const parsed = JSON.parse(info.result) as { deleted?: string };
              if (typeof parsed?.deleted === "string") sidekickRef.current.removeSpec(parsed.deleted);
            } catch { /* ignore parse errors */ }
          }
        },
        onSpecSaved(spec) {
          const pendingId = pendingSpecIdsRef.current.shift();
          if (pendingId) sidekickRef.current.removeSpec(pendingId);
          sidekickRef.current.pushSpec(spec);
        },
        onSpecsTitle(title) {
          const pctx = projectCtxRef.current;
          if (pctx) pctx.setProject((prev) => ({ ...prev, specs_title: title }));
        },
        onSpecsSummary(summary) {
          const pctx = projectCtxRef.current;
          if (pctx) pctx.setProject((prev) => ({ ...prev, specs_summary: summary }));
        },
        onTaskSaved(task) {
          const pendingId = pendingTaskIdsRef.current.shift();
          if (pendingId) sidekickRef.current.removeTask(pendingId);
          sidekickRef.current.pushTask(task);
        },
        onMessageSaved: (msg) => handleMessageSaved(refs, setters, msg),
        onAgentInstanceUpdated: (instance) => sidekickRef.current.notifyAgentInstanceUpdate(instance),
        onTokenUsage() {},
        onError: (message) => handleStreamError(refs, setters, message),
        onDone: () => {
          finalizeStream(refs, setters, abortRef, isStreamingRef.current);
          sidekickRef.current.setStreamingAgentInstanceId(null);
        },
      };

      try {
        await api.sendMessageStream(
          projectId, agentInstanceId, userMsg.content, action, null,
          attachments, callbacks, controller.signal,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err instanceof Error ? err.message : String(err));
      } finally {
        core.setIsStreaming(false);
        sidekickRef.current.setStreamingAgentInstanceId(null);
        abortRef.current = null;
      }
    },
    [projectId, agentInstanceId],
  );

  const stopStreaming = useCallback(() => {
    core.baseStopStreaming();
    sidekickRef.current.setStreamingAgentInstanceId(null);

    if (projectId && agentInstanceId) {
      const refetch = () => {
        api.getAgentInstance(projectId, agentInstanceId).then((instance) => {
          sidekickRef.current.notifyAgentInstanceUpdate(instance);
        }).catch(() => {});
      };
      setTimeout(refetch, 2000);
      setTimeout(refetch, 5000);
    }
  }, [projectId, agentInstanceId, core.baseStopStreaming]);

  return {
    messages: core.messages,
    isStreaming: core.isStreaming,
    streamingText: core.streamingText,
    thinkingText: core.thinkingText,
    thinkingDurationMs: core.thinkingDurationMs,
    activeToolCalls: core.activeToolCalls,
    progressText: core.progressText,
    sendMessage,
    stopStreaming,
    resetMessages: core.resetMessages,
    rafRef: core.rafRef,
  };
}
