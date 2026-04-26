import React from "react";
import { api } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useAutomationLoopStore } from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";
import type { StreamEventHandler } from "../../api/streams";
import type { AuraEvent } from "../../shared/types/aura-events";
import { EventType } from "../../shared/types/aura-events";

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
  getThinkingDurationMs,
} from "../use-stream-core";

import {
  pushPendingSpec,
  pushPendingTask,
  removePendingArtifact,
  promotePendingSpec,
  promotePendingTask,
  backfillToolCallInput,
  isTaskBackfillTool,
  clearAllPendingArtifacts,
  dropPendingByTitle,
} from "./optimistic-artifacts";
import {
  useContextUsageStore,
  approxTokensFromText,
} from "../../stores/context-usage-store";

export interface DispatchDeps {
  projectId: string;
  agentInstanceId: string | undefined;
  selectedModel?: string | null;
  refs: ReturnType<typeof useStreamCore>["refs"];
  setters: ReturnType<typeof useStreamCore>["setters"];
  abortRef: ReturnType<typeof useStreamCore>["abortRef"];
  coreKey: string;
  setProgressText: (t: string) => void;
  sidekickRef: React.MutableRefObject<ReturnType<typeof useSidekickStore.getState>>;
  projectCtxRef: React.MutableRefObject<ReturnType<typeof useProjectActions>>;
  pendingSpecIdsRef: React.MutableRefObject<string[]>;
  pendingTaskIdsRef: React.MutableRefObject<string[]>;
}

/** Mirrors the play button (POST /loop/*). Server is authoritative; avoid extra start calls when status already shows a loop.
 *
 * Loop control here always targets the project's `Loop`-role agent
 * instance, NOT the chat surface's `agentInstanceId`. Sending the
 * chat instance id would either collide with the in-flight chat turn
 * (harness "one in-flight turn per agent_id" rule) or — worse — turn
 * the chat thread into a loop runner. We omit the id on start so the
 * backend resolves / creates the canonical loop instance, capture it
 * in the shared store, and use the bound id for pause / resume / stop.
 */
async function bridgeLoopToolResult(
  name: string,
  isError: boolean,
  projectId: string,
  selectedModel: string | null | undefined,
) {
  if (isError) return;
  const loopStore = useAutomationLoopStore.getState();
  const boundLoopId = loopStore.loopByProject[projectId] ?? null;
  switch (name) {
    case "start_dev_loop": {
      try {
        const status = await api.getLoopStatus(projectId);
        if ((status.active_agent_instances?.length ?? 0) > 0) {
          if (status.paused) await api.resumeLoop(projectId, boundLoopId ?? undefined);
          return;
        }
        const res = await api.startLoop(projectId, undefined, selectedModel);
        if (res.agent_instance_id) {
          useAutomationLoopStore
            .getState()
            .setLoopAgent(projectId as ProjectId, res.agent_instance_id);
        }
      } catch {
        /* ignore; automation bar / WS will reflect server state */
      }
      break;
    }
    case "pause_dev_loop":
      api.pauseLoop(projectId, boundLoopId ?? undefined).catch(() => {});
      break;
    case "stop_dev_loop":
      api.stopLoop(projectId, boundLoopId ?? undefined).catch(() => {});
      break;
    case "resume_dev_loop":
      api.resumeLoop(projectId, boundLoopId ?? undefined).catch(() => {});
      break;
  }
}

export function buildStreamHandler(deps: DispatchDeps): StreamEventHandler {
  const {
    projectId, agentInstanceId, selectedModel, refs, setters, abortRef, coreKey,
    setProgressText, sidekickRef, projectCtxRef,
    pendingSpecIdsRef, pendingTaskIdsRef,
  } = deps;

  const onEvent = (event: AuraEvent) => {
    switch (event.type) {
      case EventType.Delta:
      case EventType.TextDelta: {
        const text = (event.content as { text: string }).text;
        handleTextDelta(refs, setters, getThinkingDurationMs(coreKey), text);
        useContextUsageStore
          .getState()
          .bumpEstimatedTokens(coreKey, approxTokensFromText(text));
        break;
      }
      case EventType.ThinkingDelta: {
        const tc = event.content as { text?: string; thinking?: string };
        const text = tc.text ?? tc.thinking ?? "";
        handleThinkingDelta(refs, setters, text);
        useContextUsageStore
          .getState()
          .bumpEstimatedTokens(coreKey, approxTokensFromText(text));
        break;
      }
      case EventType.Progress:
        setProgressText(event.content.stage);
        break;
      case EventType.ToolCallStarted:
      case EventType.ToolUseStart: {
        const tcs = event.content as { id: string; name: string };
        handleToolCallStarted(refs, setters, tcs);
        // Surface optimistic spec/task placeholders the moment the tool
        // actually starts running so the sidekick doesn't sit empty for
        // the duration of the tool call.
        if (tcs.name === "create_spec") {
          pushPendingSpec({ id: tcs.id, name: tcs.name }, projectId, sidekickRef.current, pendingSpecIdsRef);
        } else if (tcs.name === "create_task") {
          pushPendingTask({ id: tcs.id, name: tcs.name }, projectId, sidekickRef.current, pendingTaskIdsRef);
        }
        break;
      }
      case EventType.ToolCallSnapshot: {
        const snap = event.content;
        handleToolCallSnapshot(refs, setters, snap);
        // Update the optimistic placeholder title as the model streams
        // arguments (`title`, `spec_id`, `description`, ...). pushSpec /
        // pushTask upsert by id, so re-calling here is safe.
        if (snap.name === "create_spec") {
          pushPendingSpec(snap, projectId, sidekickRef.current, pendingSpecIdsRef);
        } else if (snap.name === "create_task") {
          pushPendingTask(snap, projectId, sidekickRef.current, pendingTaskIdsRef);
        }
        break;
      }
      case EventType.ToolCall: {
        const c = event.content;
        coreHandleToolCall(refs, setters, c);
        // `ToolCall` is the finalized args payload; if we missed the
        // earlier start/snapshot events (e.g. network gap), still seed a
        // placeholder here. pushPendingSpec/Task are idempotent by id.
        if (c.name === "create_spec") pushPendingSpec(c, projectId, sidekickRef.current, pendingSpecIdsRef);
        if (c.name === "create_task") pushPendingTask(c, projectId, sidekickRef.current, pendingTaskIdsRef);
        break;
      }
      case EventType.ToolResult: {
        const c = event.content as { id: string; name: string; result: string; is_error: boolean };
        coreHandleToolResult(refs, setters, c);
        // Tool results count against the context window; approximate
        // from the result body so the Context pill moves immediately
        // rather than only after the next AssistantMessageEnd.
        if (typeof c.result === "string" && c.result.length > 0) {
          useContextUsageStore
            .getState()
            .bumpEstimatedTokens(coreKey, approxTokensFromText(c.result));
        }
        void bridgeLoopToolResult(c.name, c.is_error, projectId, selectedModel);
        if (c.name === "create_spec") {
          if (c.is_error) removePendingArtifact(c.id, pendingSpecIdsRef, (id) => sidekickRef.current.removeSpec(id));
          else promotePendingSpec(c, projectId, sidekickRef.current, pendingSpecIdsRef);
        }
        if (c.name === "create_task") {
          if (c.is_error) removePendingArtifact(c.id, pendingTaskIdsRef, (id) => sidekickRef.current.removeTask(id));
          else {
            promotePendingTask(c, projectId, sidekickRef.current, pendingTaskIdsRef);
          }
        }
        if (!c.is_error && isTaskBackfillTool(c.name)) {
          backfillToolCallInput(refs, setters, event.content as Record<string, unknown>);
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
        const spec = event.content.spec;
        // Match by title rather than FIFO-shifting so concurrent specs
        // in flight (or engine-channel SpecSaveds arriving out of order)
        // don't evict an unrelated placeholder.
        dropPendingByTitle(
          pendingSpecIdsRef,
          spec.title,
          (id) =>
            (sidekickRef.current.specs ?? []).find((s) => s.spec_id === id)?.title,
          (id) => sidekickRef.current.removeSpec(id),
        );
        sidekickRef.current.pushSpec(spec);
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
        const task = event.content.task;
        dropPendingByTitle(
          pendingTaskIdsRef,
          task.title,
          (id) =>
            (sidekickRef.current.tasks ?? []).find((t) => t.task_id === id)?.title,
          (id) => sidekickRef.current.removeTask(id),
        );
        sidekickRef.current.pushTask(task);
        break;
      }
      case EventType.MessageEnd:
        handleEventSaved(refs, setters, event.content.event);
        break;
      case EventType.AssistantMessageEnd: {
        handleAssistantTurnBoundary(refs, setters);
        const amc = event.content as {
          stop_reason?: string;
          usage?: { context_utilization?: number; estimated_context_tokens?: number };
        };
        if (amc.usage?.context_utilization != null) {
          useContextUsageStore
            .getState()
            .setContextUtilization(
              coreKey,
              amc.usage.context_utilization,
              amc.usage.estimated_context_tokens,
            );
        }
        if (amc.stop_reason !== "tool_use") {
          resetStreamBuffers(refs, setters);
          setters.setIsStreaming(false);
          if (agentInstanceId) {
            sidekickRef.current.setAgentStreaming(agentInstanceId, false);
          }
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
      case EventType.GenerationStart:
        setProgressText(event.content.mode === "image" ? "Generating image..." : "Generating 3D model...");
        break;
      case EventType.GenerationProgress:
        setProgressText(event.content.message || `${event.content.percent}%`);
        break;
      case EventType.GenerationPartialImage:
        break;
      case EventType.GenerationCompleted: {
        const gc = event.content;
        const toolName = gc.mode === "3d" ? "generate_3d_model" : "generate_image";
        const toolId = `gen-${Date.now()}`;
        coreHandleToolCall(refs, setters, { id: toolId, name: toolName, input: {} });
        coreHandleToolResult(refs, setters, { id: toolId, name: toolName, result: JSON.stringify(gc), is_error: false });
        resetStreamBuffers(refs, setters);
        setters.setIsStreaming(false);
        if (agentInstanceId) {
          sidekickRef.current.setAgentStreaming(agentInstanceId, false);
        }
        break;
      }
      case EventType.GenerationError:
        handleStreamError(refs, setters, event.content.message);
        break;
      case EventType.Error:
        handleStreamError(refs, setters, event.content.message);
        break;
      case EventType.Done:
        finalizeStream(refs, setters, abortRef, false);
        if (agentInstanceId) {
          sidekickRef.current.setAgentStreaming(agentInstanceId, false);
        }
        clearAllPendingArtifacts(pendingSpecIdsRef, (id) =>
          sidekickRef.current.removeSpec(id),
        );
        clearAllPendingArtifacts(pendingTaskIdsRef, (id) =>
          sidekickRef.current.removeTask(id),
        );
        break;
    }
  };

  return {
    onEvent,
    onError: (error) => {
      handleStreamError(refs, setters, error);
      if (agentInstanceId) {
        sidekickRef.current.setAgentStreaming(agentInstanceId, false);
      }
      clearAllPendingArtifacts(pendingSpecIdsRef, (id) =>
        sidekickRef.current.removeSpec(id),
      );
      clearAllPendingArtifacts(pendingTaskIdsRef, (id) =>
        sidekickRef.current.removeTask(id),
      );
    },
    onDone: () => {
      finalizeStream(refs, setters, abortRef, false);
      if (agentInstanceId) {
        sidekickRef.current.setAgentStreaming(agentInstanceId, false);
      }
      clearAllPendingArtifacts(pendingSpecIdsRef, (id) =>
        sidekickRef.current.removeSpec(id),
      );
      clearAllPendingArtifacts(pendingTaskIdsRef, (id) =>
        sidekickRef.current.removeTask(id),
      );
    },
  };
}
