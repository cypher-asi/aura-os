import React, { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { useSidekickStore } from "../stores/sidekick-store";
import { useProjectContext } from "../stores/project-action-store";
import type { StreamEventHandler } from "../api/streams";
import type { AuraEvent } from "../types/aura-events";
import { EventType } from "../types/aura-events";
import type { ChatAttachment } from "../api/streams";
import { useChatHistoryStore, projectChatHistoryKey } from "../stores/chat-history-store";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall as coreHandleToolCall,
  handleToolResult as coreHandleToolResult,
  handleEventSaved,
  handleAssistantTurnBoundary,
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
  DisplaySessionEvent,
  ToolCallEntry,
} from "../types/stream";

import type { DisplayContentBlockUnion, ToolCallEntry } from "../types/stream";

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
  sidekick: ReturnType<typeof useSidekickStore.getState>,
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
  sidekick: ReturnType<typeof useSidekickStore.getState>,
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

function promotePendingSpec(
  content: { id: string; result: string },
  projectId: string,
  sidekick: ReturnType<typeof useSidekickStore.getState>,
  pendingSpecIdsRef: { current: string[] },
) {
  try {
    const parsed = JSON.parse(content.result);
    const raw = parsed?.spec ?? parsed;
    if (!raw || typeof raw !== "object") return;

    const specId = raw.spec_id ?? raw.id;
    if (!specId || typeof specId !== "string") return;

    const now = new Date().toISOString();
    const title = raw.title ?? "Untitled";

    removePendingArtifact(content.id, pendingSpecIdsRef, (id) => sidekick.removeSpec(id));

    sidekick.pushSpec({
      spec_id: specId,
      project_id: raw.project_id ?? projectId,
      title,
      order_index: raw.order_index ?? raw.order ?? orderIndexFromTitle(title) ?? 0,
      markdown_contents: raw.markdown_contents ?? raw.content ?? "",
      created_at: raw.created_at ?? now,
      updated_at: raw.updated_at ?? now,
    });
  } catch { /* result wasn't parseable JSON – leave pending for SpecSaved fallback */ }
}

function promotePendingTask(
  content: { id: string; result: string },
  projectId: string,
  sidekick: ReturnType<typeof useSidekickStore.getState>,
  pendingTaskIdsRef: { current: string[] },
) {
  try {
    const parsed = JSON.parse(content.result);
    const raw = parsed?.task ?? parsed;
    if (!raw || typeof raw !== "object") return;

    const taskId = raw.task_id ?? raw.id;
    if (!taskId || typeof taskId !== "string") return;

    const now = new Date().toISOString();

    removePendingArtifact(content.id, pendingTaskIdsRef, (id) => sidekick.removeTask(id));

    sidekick.pushTask({
      task_id: taskId,
      project_id: raw.project_id ?? projectId,
      spec_id: raw.spec_id ?? "",
      title: raw.title ?? "Untitled",
      description: raw.description ?? "",
      status: raw.status ?? "pending",
      order_index: raw.order_index ?? raw.order ?? 0,
      dependency_ids: raw.dependency_ids ?? raw.dependencies ?? [],
      parent_task_id: raw.parent_task_id ?? null,
      assigned_agent_instance_id: raw.assigned_agent_instance_id ?? null,
      completed_by_agent_instance_id: raw.completed_by_agent_instance_id ?? null,
      session_id: raw.session_id ?? null,
      execution_notes: raw.execution_notes ?? "",
      files_changed: raw.files_changed ?? [],
      live_output: raw.live_output ?? "",
      total_input_tokens: raw.total_input_tokens ?? 0,
      total_output_tokens: raw.total_output_tokens ?? 0,
      created_at: raw.created_at ?? now,
      updated_at: raw.updated_at ?? now,
    });
  } catch { /* result wasn't parseable JSON – leave pending for TaskSaved fallback */ }
}

/**
 * After a create_task tool result arrives, parse the result JSON and
 * patch the ToolCallEntry.input so the header summary and expanded
 * TaskCreatedIndicator can display the task title/description.
 *
 * Called after coreHandleToolResult which already resolved the entry
 * (setting pending=false, result=...).  We locate that entry the same
 * way: by explicit id/tool_use_id, or by scanning for the most-recent
 * just-resolved "create_task" entry — mirroring the harness fallback
 * in handlers.ts handleToolResult.
 */
function backfillToolCallInput(
  refs: { toolCalls: { current: ToolCallEntry[] } },
  setters: { setActiveToolCalls: (v: ToolCallEntry[]) => void },
  c: Record<string, unknown>,
): void {
  try {
    const result = c.result as string;
    const parsed = JSON.parse(result);
    const raw = parsed?.task ?? parsed;
    if (!raw || typeof raw === "string") return;

    const toolId = (c.id as string) || (c.tool_use_id as string);
    let idx = -1;
    if (toolId) {
      idx = refs.toolCalls.current.findIndex((tc) => tc.id === toolId);
    }
    if (idx === -1) {
      for (let i = refs.toolCalls.current.length - 1; i >= 0; i--) {
        const tc = refs.toolCalls.current[i];
        if (tc.name === "create_task" && !tc.pending && tc.result === result) {
          idx = i;
          break;
        }
      }
    }
    if (idx === -1) return;

    refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
      i === idx
        ? { ...tc, input: { ...tc.input, title: raw.title, description: raw.description } }
        : tc,
    );
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  } catch { /* ignore unparseable results */ }
}

/* ------------------------------------------------------------------ */
/*  Event dispatcher                                                   */
/* ------------------------------------------------------------------ */

interface DispatchDeps {
  projectId: string;
  agentInstanceId: string | undefined;
  refs: ReturnType<typeof useStreamCore>["refs"];
  setters: ReturnType<typeof useStreamCore>["setters"];
  abortRef: ReturnType<typeof useStreamCore>["abortRef"];
  coreKey: string;
  setProgressText: (t: string) => void;
  sidekickRef: React.MutableRefObject<ReturnType<typeof useSidekickStore.getState>>;
  projectCtxRef: React.MutableRefObject<ReturnType<typeof useProjectContext>>;
  pendingSpecIdsRef: React.MutableRefObject<string[]>;
  pendingTaskIdsRef: React.MutableRefObject<string[]>;
}

/** Mirrors the play button (POST /loop/*). Server is authoritative; avoid extra start calls when status already shows a loop. */
async function bridgeLoopToolResult(
  name: string,
  isError: boolean,
  projectId: string,
  agentInstanceId: string | undefined,
) {
  if (isError) return;
  switch (name) {
    case "start_dev_loop": {
      try {
        const status = await api.getLoopStatus(projectId);
        if ((status.active_agent_instances?.length ?? 0) > 0) return;
        await api.startLoop(projectId, agentInstanceId);
      } catch {
        /* ignore; automation bar / WS will reflect server state */
      }
      break;
    }
    case "pause_dev_loop":
      api.pauseLoop(projectId, agentInstanceId).catch(() => {});
      break;
    case "stop_dev_loop":
      api.stopLoop(projectId, agentInstanceId).catch(() => {});
      break;
  }
}

function buildStreamHandler(deps: DispatchDeps): StreamEventHandler {
  const {
    projectId, agentInstanceId, refs, setters, abortRef, coreKey,
    setProgressText, sidekickRef, projectCtxRef,
    pendingSpecIdsRef, pendingTaskIdsRef,
  } = deps;

  const onEvent = (event: AuraEvent) => {
    switch (event.type) {
      case EventType.Delta:
      case EventType.TextDelta:
        handleTextDelta(refs, setters, getThinkingDurationMs(coreKey), (event.content as { text: string }).text);
        break;
      case EventType.ThinkingDelta: {
        const tc = event.content as { text?: string; thinking?: string };
        handleThinkingDelta(refs, setters, tc.text ?? tc.thinking ?? "");
        break;
      }
      case EventType.Progress:
        setProgressText(event.content.stage);
        break;
      case EventType.ToolCallStarted:
      case EventType.ToolUseStart:
        handleToolCallStarted(refs, setters, event.content as { id: string; name: string });
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
        const c = event.content as { id: string; name: string; result: string; is_error: boolean };
        coreHandleToolResult(refs, setters, c);
        void bridgeLoopToolResult(c.name, c.is_error, projectId, agentInstanceId);
        if (c.name === "create_spec") {
          if (c.is_error) removePendingArtifact(c.id, pendingSpecIdsRef, (id) => sidekickRef.current.removeSpec(id));
          else promotePendingSpec(c, projectId, sidekickRef.current, pendingSpecIdsRef);
        }
        if (c.name === "create_task") {
          if (c.is_error) removePendingArtifact(c.id, pendingTaskIdsRef, (id) => sidekickRef.current.removeTask(id));
          else {
            promotePendingTask(c, projectId, sidekickRef.current, pendingTaskIdsRef);
            backfillToolCallInput(refs, setters, event.content as Record<string, unknown>);
          }
        }
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
        handleEventSaved(refs, setters, event.content.event);
        break;
      case EventType.AssistantMessageEnd: {
        handleAssistantTurnBoundary(refs, setters);
        const stopReason = (event.content as { stop_reason?: string }).stop_reason;
        if (stopReason !== "tool_use") {
          resetStreamBuffers(refs, setters);
          setters.setIsStreaming(false);
          sidekickRef.current.setStreamingAgentInstanceId(null);
        }
        break;
      }
      case EventType.AgentInstanceUpdated:
        sidekickRef.current.notifyAgentInstanceUpdate(event.content.agent_instance);
        break;
      case EventType.AssistantMessageStart:
        break;
      case EventType.SessionReady:
        break;
      case EventType.TokenUsage:
        break;
      case EventType.Error:
        handleStreamError(refs, setters, event.content.message);
        break;
      case EventType.Done:
        finalizeStream(refs, setters, abortRef, false);
        sidekickRef.current.setStreamingAgentInstanceId(null);
        break;
    }
  };

  return {
    onEvent,
    onError: (message) => handleStreamError(refs, setters, message),
    onDone: () => {
      finalizeStream(refs, setters, abortRef, false);
      sidekickRef.current.setStreamingAgentInstanceId(null);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useChatStream({ projectId, agentInstanceId }: UseChatStreamOptions) {
  const sidekickRef = useRef(useSidekickStore.getState());
  const projectCtx = useProjectContext();
  const projectCtxRef = useRef(projectCtx);

  useEffect(() => useSidekickStore.subscribe((s) => { sidekickRef.current = s; }), []);
  useEffect(() => { projectCtxRef.current = projectCtx; }, [projectCtx]);

  const core = useStreamCore([projectId, agentInstanceId]);
  const { refs, setters, abortRef } = core;
  const pendingSpecIdsRef = useRef<string[]>([]);
  const pendingTaskIdsRef = useRef<string[]>([]);

  useEffect(() => () => {
    if (!getIsStreaming(core.key)) sidekickRef.current.setStreamingAgentInstanceId(null);
  }, [projectId, agentInstanceId, core.key]);

  const sendMessage = useCallback(
    async (content: string, action: string | null = null, selectedModel?: string | null, attachments?: ChatAttachment[], commands?: string[]) => {
      if (!projectId || !agentInstanceId || getIsStreaming(core.key)) return;
      const trimmed = content.trim();
      if (!trimmed && !action && !(attachments && attachments.length > 0)) return;

      const userMsg = {
        id: `temp-${Date.now()}`,
        role: "user" as const,
        content: trimmed || (action === "generate_specs" ? "Generate specs for this project" : trimmed) || buildAttachmentLabel(attachments),
        contentBlocks: buildContentBlocks(trimmed, attachments),
      };
      core.setEvents((prev) => [...prev, userMsg]);
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

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const handler = buildStreamHandler({
        projectId, agentInstanceId, refs, setters, abortRef, coreKey: core.key,
        setProgressText: core.setProgressText, sidekickRef, projectCtxRef,
        pendingSpecIdsRef, pendingTaskIdsRef,
      });

      try {
        await api.sendEventStream(projectId, agentInstanceId, userMsg.content, action, selectedModel, attachments, handler, controller.signal, commands);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err instanceof Error ? err.message : String(err));
      } finally {
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          sidekickRef.current.setStreamingAgentInstanceId(null);
          controller.abort();
          abortRef.current = null;
        }
        if (projectId && agentInstanceId) {
          useChatHistoryStore.getState().invalidateHistory(
            projectChatHistoryKey(projectId, agentInstanceId),
          );
        }
      }
    },
    [projectId, agentInstanceId, core.key, refs, setters, abortRef, core.setEvents, core.setIsStreaming, core.setProgressText],
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

  return { streamKey: core.key, sendMessage, stopStreaming, resetEvents: core.resetEvents };
}
