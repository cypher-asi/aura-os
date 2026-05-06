import { useRef, useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { generate3dStream, generateImageStream } from "../../api/streams";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import type { ChatAttachment } from "../../api/streams";
import { DEFAULT_IMAGE_MODEL_ID, type GenerationMode } from "../../constants/models";
import { STYLE_LOCK_SUFFIX } from "../../constants/generation";
import { EventType } from "../../shared/types/aura-events";

import {
  useStreamCore,
  resetStreamBuffers,
  handleStreamError,
  getIsStreaming,
} from "../use-stream-core";
import { buildUserChatMessage } from "../attachment-helpers";
import { buildStreamHandler } from "./build-stream-handler";

interface UseChatStreamOptions {
  projectId: string | undefined;
  agentInstanceId: string | undefined;
}

export function useChatStream({ projectId, agentInstanceId }: UseChatStreamOptions) {
  const sidekickRef = useRef(useSidekickStore.getState());
  const projectCtx = useProjectActions();
  const projectCtxRef = useRef(projectCtx);

  useEffect(() => useSidekickStore.subscribe((s) => { sidekickRef.current = s; }), []);
  useEffect(() => { projectCtxRef.current = projectCtx; }, [projectCtx]);

  const core = useStreamCore([projectId, agentInstanceId]);
  const { refs, setters, abortRef } = core;
  const pendingSpecIdsRef = useRef<string[]>([]);
  const pendingTaskIdsRef = useRef<string[]>([]);
  const nextSendStartsNewSessionRef = useRef(false);
  // See `use-agent-chat-stream.ts`: synchronous latch covering the gap
  // between `sendMessage` invocation and the moment `setIsStreaming(true)`
  // propagates through Zustand. Without it two clicks (or a click + queue
  // dequeue replay) landing in the same microtask both pass the
  // `getIsStreaming` read and proceed to issue parallel POSTs.
  const inFlightRef = useRef(false);

  useEffect(() => () => {
    if (agentInstanceId && !getIsStreaming(core.key)) {
      sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    }
  }, [projectId, agentInstanceId, core.key]);

  const sendMessage = useCallback(
    async (
      content: string,
      action: string | null = null,
      selectedModel?: string | null,
      attachments?: ChatAttachment[],
      commands?: string[],
      _projectIdOverride?: string,
      _generationMode?: GenerationMode,
      _sourceImageUrl?: string,
    ) => {
      if (!projectId || !agentInstanceId || inFlightRef.current || getIsStreaming(core.key)) return;
      const trimmed = content.trim();
      if (!trimmed && !action && !(attachments && attachments.length > 0)) return;

      inFlightRef.current = true;

      const userMsg = buildUserChatMessage(
        trimmed,
        attachments,
        action === "generate_specs" ? "Generate specs for this project" : undefined,
      );
      core.setEvents((prev) => [...prev, userMsg]);
      core.setIsStreaming(true);
      sidekickRef.current.setAgentStreaming(agentInstanceId, true);
      resetStreamBuffers(refs, setters);
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
        projectId, agentInstanceId, selectedModel, refs, setters, abortRef, coreKey: core.key,
        setProgressText: core.setProgressText, sidekickRef, projectCtxRef,
        pendingSpecIdsRef, pendingTaskIdsRef,
      });

      try {
        const shouldStartNewSession = nextSendStartsNewSessionRef.current;
        nextSendStartsNewSessionRef.current = false;
        if (_generationMode === "image") {
          core.setProgressText("Generating image...");
          // Forward project + agent-instance ids so the server can
          // resolve the project chat session and persist this turn
          // into history — without it the synthesized `generate_image`
          // tool turn is in-memory only and is lost on hard reload.
          await generateImageStream(
            userMsg.content,
            selectedModel,
            attachments,
            handler,
            controller.signal,
            { projectId, agentInstanceId },
          );
          return;
        }

        if (_generationMode === "3d") {
          // Chat 3D mode is a two-step in-bar pipeline:
          //   - no pinned source image → run the AURA-styled image
          //     step and pin the result so the next send can
          //     convert it to 3D;
          //   - pinned source image → run the image-to-3D model step
          //     against the pinned URL and clear the pin on
          //     completion.
          // The branch is keyed on `_sourceImageUrl`, which the
          // panel-state layer sources from the per-stream pinned
          // image slice in `chat-ui-store` (NOT from chat history).
          if (!_sourceImageUrl) {
            const styledPrompt = `${userMsg.content}${STYLE_LOCK_SUFFIX}`;
            core.setProgressText("Generating image...");
            await generateImageStream(
              styledPrompt,
              DEFAULT_IMAGE_MODEL_ID,
              attachments,
              {
                ...handler,
                onEvent(event) {
                  handler.onEvent(event);
                  if (
                    event.type === EventType.GenerationCompleted &&
                    event.content.mode === "image" &&
                    event.content.imageUrl
                  ) {
                    useChatUIStore.getState().setPinnedSourceImage(core.key, {
                      imageUrl: event.content.imageUrl,
                      originalUrl: event.content.originalUrl,
                      // Persist the user's verbatim prompt (without the
                      // style suffix) so the thumb tooltip / future
                      // refinement chips read naturally.
                      prompt: userMsg.content,
                    });
                  }
                },
              },
              controller.signal,
              { projectId, agentInstanceId },
            );
            return;
          }
          core.setProgressText("Generating 3D model...");
          await generate3dStream(
            { kind: "url", imageUrl: _sourceImageUrl },
            trimmed || null,
            {
              ...handler,
              onEvent(event) {
                handler.onEvent(event);
                if (
                  event.type === EventType.GenerationCompleted &&
                  event.content.mode === "3d" &&
                  event.content.glbUrl
                ) {
                  useChatUIStore.getState().setPinnedSourceImage(core.key, null);
                }
              },
            },
            controller.signal,
            projectId,
          );
          return;
        }

        const modelForTurn = _generationMode ? null : selectedModel;
        await api.sendEventStream(
          projectId,
          agentInstanceId,
          userMsg.content,
          action,
          modelForTurn,
          attachments,
          handler,
          controller.signal,
          commands,
          shouldStartNewSession,
        );
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err);
      } finally {
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          sidekickRef.current.setAgentStreaming(agentInstanceId, false);
          controller.abort();
          abortRef.current = null;
        }
        // Whatever path we took out (success, error, abort), drop any
        // placeholders that were never promoted. Safe because successful
        // promotions have already removed themselves from these refs.
        for (const id of pendingSpecIdsRef.current) {
          sidekickRef.current.removeSpec(id);
        }
        pendingSpecIdsRef.current = [];
        for (const id of pendingTaskIdsRef.current) {
          sidekickRef.current.removeTask(id);
        }
        pendingTaskIdsRef.current = [];
        inFlightRef.current = false;
      }
    },
    [projectId, agentInstanceId, core.key, refs, setters, abortRef, core.setEvents, core.setIsStreaming, core.setProgressText],
  );

  const stopStreaming = useCallback(() => {
    core.baseStopStreaming();
    if (agentInstanceId) {
      sidekickRef.current.setAgentStreaming(agentInstanceId, false);
    }
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
    streamKey: core.key,
    sendMessage,
    stopStreaming,
    resetEvents: core.resetEvents,
    markNextSendAsNewSession: () => {
      nextSendStartsNewSessionRef.current = true;
    },
  };
}
