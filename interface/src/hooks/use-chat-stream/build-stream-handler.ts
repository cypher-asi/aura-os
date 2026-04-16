import React from "react";
import { api } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import type { StreamEventHandler } from "../../api/streams";
import type { AuraEvent } from "../../types/aura-events";
import { EventType } from "../../types/aura-events";

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
} from "./optimistic-artifacts";
import { useContextUsageStore } from "../../stores/context-usage-store";

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

/** Mirrors the play button (POST /loop/*). Server is authoritative; avoid extra start calls when status already shows a loop. */
async function bridgeLoopToolResult(
  name: string,
  isError: boolean,
  projectId: string,
  agentInstanceId: string | undefined,
  selectedModel: string | null | undefined,
) {
  if (isError) return;
  switch (name) {
    case "start_dev_loop": {
      try {
        const status = await api.getLoopStatus(projectId);
        if ((status.active_agent_instances?.length ?? 0) > 0) {
          if (status.paused) await api.resumeLoop(projectId, agentInstanceId);
          return;
        }
        await api.startLoop(projectId, agentInstanceId, selectedModel);
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
    case "resume_dev_loop":
      api.resumeLoop(projectId, agentInstanceId).catch(() => {});
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
        void bridgeLoopToolResult(c.name, c.is_error, projectId, agentInstanceId, selectedModel);
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
        const amc = event.content as { stop_reason?: string; usage?: { context_utilization?: number } };
        if (amc.usage?.context_utilization != null) {
          useContextUsageStore.getState().setContextUtilization(coreKey, amc.usage.context_utilization);
        }
        if (amc.stop_reason !== "tool_use") {
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
        sidekickRef.current.setStreamingAgentInstanceId(null);
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
        sidekickRef.current.setStreamingAgentInstanceId(null);
        break;
    }
  };

  return {
    onEvent,
    onError: (error) => handleStreamError(refs, setters, error),
    onDone: () => {
      finalizeStream(refs, setters, abortRef, false);
      sidekickRef.current.setStreamingAgentInstanceId(null);
    },
  };
}
