import React, { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { useSidekick } from "../stores/sidekick-store";
import { useProjectContext } from "../stores/project-action-store";
import type { StreamEventHandler } from "../api/streams";
import type { AuraEvent } from "../types/aura-events";
import { EventType } from "../types/aura-events";
import type { ChatAttachment } from "../api/streams";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall as coreHandleToolCall,
  handleToolResult as coreHandleToolResult,
  handleMessageSaved,
  handleStreamError,
  finalizeStream,
  getIsStreaming,
  getThinkingDurationMs,
} from "./use-stream-core";
import { orderIndexFromTitle } from "../utils/collections";

export type {
  DisplayContentBlock,
  DisplayImageBlock,
  DisplayContentBlockUnion,
  ArtifactRef,
  DisplayMessage,
  ToolCallEntry,
} from "../types/stream";

import type { DisplayContentBlockUnion } from "../types/stream";

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
  content: { id: string; name: string; input: Record<string, unknown> },
  projectId: string,
  sidekick: ReturnType<typeof useSidekick>,
  pendingSpecIdsRef: { current: string[] },
) {
  const pendingId = `pending-${content.id}`;
  const now = new Date().toISOString();
  const title = (content.input.title as string) || "Generating…";
  sidekick.pushSpec({
    spec_id: pendingId,
    project_id: projectId,
    title,
    order_index: orderIndexFromTitle(title) ?? Date.now(),
    markdown_contents: (content.input.markdown_contents as string) || "",
    created_at: now,
    updated_at: now,
  });
  if (!pendingSpecIdsRef.current.includes(pendingId)) {
    pendingSpecIdsRef.current.push(pendingId);
  }
}

function pushPendingTask(
  content: { id: string; name: string; input: Record<string, unknown> },
  projectId: string,
  sidekick: ReturnType<typeof useSidekick>,
  pendingTaskIdsRef: { current: string[] },
) {
  const pendingId = `pending-${content.id}`;
  const now = new Date().toISOString();
  const title = (content.input.title as string) || "Creating…";
  sidekick.pushTask({
    task_id: pendingId,
    project_id: projectId,
    spec_id: (content.input.spec_id as string) || "",
    title,
    description: (content.input.description as string) || "",
    status: "pending",
    order_index: orderIndexFromTitle(title) ?? Date.now(),
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
/*  Event dispatcher                                                   */
/* ------------------------------------------------------------------ */

interface DispatchDeps {
  projectId: string;
  refs: ReturnType<typeof useStreamCore>["refs"];
  setters: ReturnType<typeof useStreamCore>["setters"];
  abortRef: ReturnType<typeof useStreamCore>["abortRef"];
  coreKey: string;
  setProgressText: (t: string) => void;
  sidekickRef: React.MutableRefObject<ReturnType<typeof useSidekick>>;
  projectCtxRef: React.MutableRefObject<ReturnType<typeof useProjectContext>>;
  pendingSpecIdsRef: React.MutableRefObject<string[]>;
  pendingTaskIdsRef: React.MutableRefObject<string[]>;
}

function buildStreamHandler(deps: DispatchDeps): StreamEventHandler {
  const {
    projectId, refs, setters, abortRef, coreKey,
    setProgressText, sidekickRef, projectCtxRef,
    pendingSpecIdsRef, pendingTaskIdsRef,
  } = deps;

  const onEvent = (event: AuraEvent) => {
    switch (event.type) {
      case EventType.Delta:
        handleTextDelta(refs, setters, getThinkingDurationMs(coreKey), event.content.text);
        break;
      case EventType.ThinkingDelta:
        handleThinkingDelta(refs, setters, event.content.text);
        break;
      case EventType.Progress:
        setProgressText(event.content.stage);
        break;
      case EventType.ToolCallStarted:
        handleToolCallStarted(refs, setters, event.content);
        break;
      case EventType.ToolCallSnapshot:
        handleToolCallSnapshot(refs, setters, event.content);
        break;
      case EventType.ToolCall: {
        const c = event.content;
        coreHandleToolCall(refs, setters, c);
        if (c.name === "create_spec") pushPendingSpec(c, projectId, sidekickRef.current, pendingSpecIdsRef);
        if (c.name === "create_task") pushPendingTask(c, projectId, sidekickRef.current, pendingTaskIdsRef);
        break;
      }
      case EventType.ToolResult: {
        const c = event.content;
        coreHandleToolResult(refs, setters, c);
        if (c.name === "create_spec" && c.is_error) removePendingArtifact(c.id, pendingSpecIdsRef, (id) => sidekickRef.current.removeSpec(id));
        if (c.name === "create_task" && c.is_error) removePendingArtifact(c.id, pendingTaskIdsRef, (id) => sidekickRef.current.removeTask(id));
        if (c.name === "delete_spec" && !c.is_error) {
          try {
            const parsed = JSON.parse(c.result) as { deleted?: string };
            if (typeof parsed?.deleted === "string") sidekickRef.current.removeSpec(parsed.deleted);
          } catch { /* ignore */ }
        }
        break;
      }
      case EventType.SpecSaved: {
        const pendingId = pendingSpecIdsRef.current.shift();
        if (pendingId) sidekickRef.current.removeSpec(pendingId);
        sidekickRef.current.pushSpec(event.content.spec);
        break;
      }
      case EventType.SpecsTitle: {
        const pctx = projectCtxRef.current;
        if (pctx) pctx.setProject((prev) => ({ ...prev, specs_title: event.content.title }));
        break;
      }
      case EventType.SpecsSummary: {
        const pctx = projectCtxRef.current;
        if (pctx) pctx.setProject((prev) => ({ ...prev, specs_summary: event.content.summary }));
        break;
      }
      case EventType.TaskSaved: {
        const pendingId = pendingTaskIdsRef.current.shift();
        if (pendingId) sidekickRef.current.removeTask(pendingId);
        sidekickRef.current.pushTask(event.content.task);
        break;
      }
      case EventType.MessageEnd:
        handleMessageSaved(refs, setters, event.content.message);
        break;
      case EventType.AgentInstanceUpdated:
        sidekickRef.current.notifyAgentInstanceUpdate(event.content.agent_instance);
        break;
      case EventType.TokenUsage:
        break;
      case EventType.Error:
        handleStreamError(refs, setters, event.content.message);
        break;
      case EventType.Done:
        finalizeStream(refs, setters, abortRef, getIsStreaming(coreKey));
        sidekickRef.current.setStreamingAgentInstanceId(null);
        break;
    }
  };

  return {
    onEvent,
    onError: (message) => handleStreamError(refs, setters, message),
    onDone: () => {
      finalizeStream(refs, setters, abortRef, getIsStreaming(coreKey));
      sidekickRef.current.setStreamingAgentInstanceId(null);
    },
  };
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
  const { refs, setters, abortRef } = core;
  const pendingSpecIdsRef = useRef<string[]>([]);
  const pendingTaskIdsRef = useRef<string[]>([]);

  useEffect(() => () => {
    if (!getIsStreaming(core.key)) sidekickRef.current.setStreamingAgentInstanceId(null);
  }, [projectId, agentInstanceId, core.key]);

  const sendMessage = useCallback(
    async (content: string, action: string | null = null, _selectedModel?: string | null, attachments?: ChatAttachment[]) => {
      if (!projectId || !agentInstanceId || getIsStreaming(core.key)) return;
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
      const handler = buildStreamHandler({
        projectId, refs, setters, abortRef, coreKey: core.key,
        setProgressText: core.setProgressText, sidekickRef, projectCtxRef,
        pendingSpecIdsRef, pendingTaskIdsRef,
      });

      try {
        await api.sendMessageStream(projectId, agentInstanceId, userMsg.content, action, null, attachments, handler, controller.signal);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err instanceof Error ? err.message : String(err));
      } finally {
        core.setIsStreaming(false);
        sidekickRef.current.setStreamingAgentInstanceId(null);
        abortRef.current = null;
      }
    },
    [projectId, agentInstanceId, core.key, refs, setters, abortRef, core.setMessages, core.setIsStreaming, core.setProgressText],
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

  return { streamKey: core.key, sendMessage, stopStreaming, resetMessages: core.resetMessages };
}
