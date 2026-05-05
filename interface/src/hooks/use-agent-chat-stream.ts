import { useRef, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { generate3dStream, generateImageStream } from "../api/streams";
import type {
  ChatAttachment,
  Generate3dSource,
  StreamEventHandler,
} from "../api/streams";
import type { GenerationMode } from "../constants/models";
import { buildUserChatMessage } from "./attachment-helpers";
import type { Spec, Task } from "../shared/types";
import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import {
  useStreamCore,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  handleEventSaved,
  handleAssistantTurnBoundary,
  handleStreamError,
  finalizeStream,
  getIsStreaming,
  getThinkingDurationMs,
} from "./use-stream-core";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { useContextUsageStore } from "../stores/context-usage-store";

interface UseAgentChatStreamOptions {
  agentId: string | undefined;
  onTaskSaved?: (task: Task) => void;
  onSpecSaved?: (spec: Spec) => void;
}

interface UseAgentChatStreamResult {
  streamKey: string;
  sendMessage: (
    content: string,
    action?: string | null,
    selectedModel?: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectId?: string,
    generationMode?: GenerationMode,
  ) => Promise<void>;
  stopStreaming: () => void;
  resetEvents: (msgs: DisplaySessionEvent[], options?: { allowWhileStreaming?: boolean }) => void;
  markNextSendAsNewSession: () => void;
}

export function useAgentChatStream({ agentId, onTaskSaved, onSpecSaved }: UseAgentChatStreamOptions): UseAgentChatStreamResult {
  const core = useStreamCore([agentId]);
  const { refs, setters, abortRef } = core;
  const nextSendStartsNewSessionRef = useRef(false);

  const onSpecSavedRef = useRef(onSpecSaved);
  useEffect(() => { onSpecSavedRef.current = onSpecSaved; }, [onSpecSaved]);

  const onTaskSavedRef = useRef(onTaskSaved);
  useEffect(() => { onTaskSavedRef.current = onTaskSaved; }, [onTaskSaved]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel?: string | null,
      attachments?: ChatAttachment[],
      commands?: string[],
      projectId?: string,
      _generationMode?: GenerationMode,
    ) => {
      if (!agentId || getIsStreaming(core.key)) return;
      const trimmed = content.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if (!trimmed && !action && !hasAttachments) return;

      const userMsg = buildUserChatMessage(trimmed, attachments);

      core.setEvents((prev) => [...prev, userMsg]);
      core.setIsStreaming(true);
      resetStreamBuffers(refs, setters);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const handler: StreamEventHandler = {
        onEvent(event: AuraEvent) {
          switch (event.type) {
            case EventType.Delta:
            case EventType.TextDelta:
              handleTextDelta(refs, setters, getThinkingDurationMs(core.key), (event.content as { text: string }).text);
              break;
            case EventType.ThinkingDelta: {
              const tc = event.content as { text?: string; thinking?: string };
              handleThinkingDelta(refs, setters, tc.text ?? tc.thinking ?? "");
              break;
            }
            case EventType.Progress:
              core.setProgressText(event.content.stage);
              break;
            case EventType.ToolCallStarted:
            case EventType.ToolUseStart:
              handleToolCallStarted(refs, setters, event.content as { id: string; name: string });
              break;
            case EventType.ToolCallSnapshot:
              handleToolCallSnapshot(refs, setters, event.content);
              break;
            case EventType.ToolCall:
              handleToolCall(refs, setters, event.content);
              break;
            case EventType.ToolResult:
              handleToolResult(refs, setters, event.content as { id: string; name: string; result: string; is_error: boolean });
              break;
            case EventType.SpecSaved:
              onSpecSavedRef.current?.(event.content.spec);
              break;
            case EventType.TaskSaved:
              onTaskSavedRef.current?.(event.content.task);
              break;
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
                    core.key,
                    amc.usage.context_utilization,
                    amc.usage.estimated_context_tokens,
                  );
              }
              if (amc.stop_reason !== "tool_use") {
                resetStreamBuffers(refs, setters);
                core.setIsStreaming(false);
              }
              break;
            }
            case EventType.AssistantMessageStart:
            case EventType.SessionReady:
            case EventType.TokenUsage:
              break;
            case EventType.GenerationStart:
              core.setProgressText(event.content.mode === "image" ? "Generating image..." : "Generating 3D model...");
              break;
            case EventType.GenerationProgress:
              core.setProgressText(event.content.message || `${event.content.percent}%`);
              break;
            case EventType.GenerationPartialImage:
              break;
            case EventType.GenerationCompleted: {
              const gc = event.content;
              const toolName = gc.mode === "3d" ? "generate_3d_model" : "generate_image";
              const toolId = `gen-${Date.now()}`;
              handleToolCall(refs, setters, { id: toolId, name: toolName, input: {} });
              handleToolResult(refs, setters, { id: toolId, name: toolName, result: JSON.stringify(gc), is_error: false });
              finalizeStream(refs, setters, abortRef, false, { reason: "completed" });
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
              break;
          }
        },
        onError: (error) => handleStreamError(refs, setters, error),
        onDone: () => finalizeStream(refs, setters, abortRef, false),
      };

      try {
        const shouldStartNewSession = nextSendStartsNewSessionRef.current;
        nextSendStartsNewSessionRef.current = false;
        if (_generationMode === "image") {
          core.setProgressText("Generating image...");
          await generateImageStream(
            userMsg.content,
            selectedModel,
            attachments,
            handler,
            controller.signal,
            projectId,
          );
          return;
        }

        if (_generationMode === "3d") {
          // Chat 3D mode bypasses the agent and calls the same
          // generation endpoint the AURA 3D app uses. An attached /
          // pasted image is forwarded as a base64 data URL
          // (image-to-3D); when no image is present we fall back to
          // text-to-3D and rely on the prompt.
          const imageAttachment = attachments?.find((a) => a.type === "image");
          // `trimmed` is the user's actual input; `userMsg.content` may be a
          // synthesized fallback like "[1 file(s)]" when there are
          // attachments but no text, which we don't want to forward as the
          // 3D prompt.
          const trimmedPrompt = trimmed;
          if (!imageAttachment && !trimmedPrompt) {
            handleStreamError(
              refs,
              setters,
              "3D mode needs either a prompt or an attached image.",
            );
            return;
          }
          core.setProgressText("Generating 3D model...");
          const source: Generate3dSource = imageAttachment
            ? {
                kind: "data",
                imageData: `data:${imageAttachment.media_type};base64,${imageAttachment.data}`,
              }
            : { kind: "none" };
          await generate3dStream(
            source,
            trimmedPrompt || null,
            handler,
            controller.signal,
            projectId,
          );
          return;
        }

        const modelForTurn = _generationMode ? null : selectedModel;
        await api.agents.sendEventStream(
          agentId,
          userMsg.content,
          action,
          modelForTurn,
          attachments,
          handler,
          controller.signal,
          commands,
          projectId,
          shouldStartNewSession,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err);
      } finally {
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          controller.abort();
          abortRef.current = null;
        }
      }
    },
    [agentId, core.key, refs, setters, abortRef, core.setEvents, core.setIsStreaming, core.setProgressText],
  );

  return {
    streamKey: core.key,
    sendMessage,
    stopStreaming: core.baseStopStreaming,
    resetEvents: core.resetEvents,
    markNextSendAsNewSession: () => {
      nextSendStartsNewSessionRef.current = true;
    },
  };
}
