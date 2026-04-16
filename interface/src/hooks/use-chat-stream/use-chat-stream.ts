import { useRef, useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import type { ChatAttachment } from "../../api/streams";
import { generateImageStream, generate3dStream } from "../../api/streams";
import type { GenerationMode } from "../../constants/models";

import {
  useStreamCore,
  resetStreamBuffers,
  handleStreamError,
  getIsStreaming,
} from "../use-stream-core";
import { buildContentBlocks, buildAttachmentLabel } from "../attachment-helpers";
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

  useEffect(() => () => {
    if (!getIsStreaming(core.key)) sidekickRef.current.setStreamingAgentInstanceId(null);
  }, [projectId, agentInstanceId, core.key]);

  const sendMessage = useCallback(
    async (content: string, action: string | null = null, selectedModel?: string | null, attachments?: ChatAttachment[], commands?: string[], _projectIdOverride?: string, generationMode?: GenerationMode) => {
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
        if (generationMode === "image") {
          await generateImageStream(trimmed, selectedModel, attachments, handler, controller.signal, projectId);
        } else if (generationMode === "3d") {
          const imgUrl = attachments?.find((a) => a.type === "image")
            ? `data:${attachments[0].media_type};base64,${attachments[0].data}`
            : trimmed;
          await generate3dStream(imgUrl, trimmed, handler, controller.signal, projectId);
        } else {
          const shouldStartNewSession = nextSendStartsNewSessionRef.current;
          nextSendStartsNewSessionRef.current = false;
          await api.sendEventStream(
            projectId,
            agentInstanceId,
            userMsg.content,
            action,
            selectedModel,
            attachments,
            handler,
            controller.signal,
            commands,
            shouldStartNewSession,
          );
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handleStreamError(refs, setters, err);
      } finally {
        if (abortRef.current === controller) {
          core.setIsStreaming(false);
          sidekickRef.current.setStreamingAgentInstanceId(null);
          controller.abort();
          abortRef.current = null;
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
