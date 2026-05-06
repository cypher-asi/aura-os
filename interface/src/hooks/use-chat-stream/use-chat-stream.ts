import { useRef, useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { generate3dStream, generateImageStream } from "../../api/streams";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import type { ChatAttachment } from "../../api/streams";
import type { GenerationMode } from "../../constants/models";

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
          // Chat 3D mode now mirrors the standalone AURA 3D app's
          // "Image -> 3D" pipeline: the source must be a previously-
          // generated image in this thread, surfaced from the chat
          // panel as `_sourceImageUrl`. The aura-router proxy only
          // exposes URL-based image-to-3D for Tripo, and the legacy
          // base64 / data-URL path is currently broken — see the
          // FF block below for the disabled fallback.
          if (_sourceImageUrl) {
            core.setProgressText("Generating 3D model...");
            await generate3dStream(
              { kind: "url", imageUrl: _sourceImageUrl },
              trimmed || null,
              handler,
              controller.signal,
              projectId,
            );
            return;
          }

          // FF: chat 3D manual-attach path is disabled while the
          // proxy decode-and-forward route is broken. The block below
          // is intentionally kept (commented) so flipping a flag once
          // the route is fixed is a one-line restore.
          //
          // const imageAttachment = attachments?.find((a) => a.type === "image");
          // if (imageAttachment) {
          //   const dataUrl = `data:${imageAttachment.media_type};base64,${imageAttachment.data}`;
          //   core.setProgressText("Generating 3D model...");
          //   await generate3dStream(
          //     { kind: "data", imageData: dataUrl },
          //     trimmed || null,
          //     handler,
          //     controller.signal,
          //     projectId,
          //   );
          //   return;
          // }

          handleStreamError(
            refs,
            setters,
            "Generate an image first, then switch to 3D mode and send again.",
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
