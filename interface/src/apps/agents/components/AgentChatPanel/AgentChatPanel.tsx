import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../../api/client";
import { useChatStream } from "../../../../hooks/use-chat-stream";
import { useChatHistorySync } from "../../../../hooks/use-chat-history-sync";
import { useDelayedLoading } from "../../../../shared/hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../../../hooks/use-agent-chat-meta";
import { setLastAgent, setLastProject } from "../../../../utils/storage";
import { ChatPanel, type ChatPanelProps } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import {
  projectChatHistoryKey,
  sessionHistoryKey,
} from "../../../../stores/chat-history-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { useContextUsage } from "../../../../stores/context-usage-store";
import { useHydrateContextUtilization } from "../../../../hooks/use-hydrate-context-utilization";
import type { AgentInstance, Project } from "../../../../shared/types";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useAgentBusy } from "../../../../hooks/use-agent-busy";
import { useTerminalTarget } from "../../../../hooks/use-terminal-target";
import { useFreshCanvas } from "../../hooks/use-fresh-canvas";
import { useOptimisticSessionRow } from "../../hooks/use-optimistic-session-row";
import { useAutoRenameFromPrompt } from "../../hooks/use-auto-rename-from-prompt";
import { useNewSessionUrlSync } from "../../hooks/use-new-session-url-sync";
import { ProjectAgentSwitcher } from "../ProjectAgentSwitcher";

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_AGENT_INSTANCES: AgentInstance[] = [];
const EMPTY_SESSION_EVENTS_FETCH = (): Promise<never[]> => Promise.resolve([]);

function selectCurrentProject(projectId: string) {
  return (state: { projects: Project[] }): Project[] => {
    const project = state.projects.find((p) => p.project_id === projectId);
    return project ? [project] : EMPTY_PROJECTS;
  };
}

interface AgentChatPanelProps {
  projectId: string;
  agentInstanceId: string;
  /** `null` means the user is on a fresh canvas (no `?session=`). */
  sessionId: string | null;
  /** Set when the panel is being opened via a "create agent" handoff so
   *  the input bar can render its first-prompt scaffolding. */
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}

/**
 * Project-scoped agent chat. Single orchestrator for both
 * `/projects/:projectId/agents/:agentInstanceId` and the agents-shell
 * branch that resolves to a project + instance + session triple.
 *
 * Owns:
 *   - URL session sync (mirrors `SessionReady` into `?session=`).
 *   - Optimistic session row + swap.
 *   - Auto-rename from first prompt.
 *   - Fresh-canvas reset semantics ("+" new-chat).
 *
 * Delegates all transcript merging to `ChatPanel`/`useChatHistorySync`;
 * the projector + conversation store rewrites in Phase B will reduce
 * the per-render plumbing further.
 */
export function AgentChatPanel({
  projectId,
  agentInstanceId,
  sessionId,
  initialCreateHandoff,
  onInitialHandoffReady,
}: AgentChatPanelProps) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { isMobileLayout } = useAuraCapabilities();
  const currentProject = useProjectsListStore(useShallow(selectCurrentProject(projectId)));
  const projectName = currentProject[0]?.name ?? "";
  const projectAgents = useProjectsListStore(
    (state) => state.agentsByProject[projectId] ?? EMPTY_AGENT_INSTANCES,
  );

  const orgAgentId = useProjectsListStore(
    (state) =>
      state.agentsByProject[projectId]?.find(
        (agent) => agent.agent_instance_id === agentInstanceId,
      )?.agent_id ?? null,
  );

  const { agentName, machineType, templateAgentId, adapterType, defaultModel } =
    useAgentChatMeta("project", { projectId, agentInstanceId });

  // Resolves the project's workspace path (and remote-agent id when
  // the project's agent runs on a remote VM). Same hook the file
  // explorer + terminal use, so @-mention reads the same tree the
  // user sees in the side panel.
  const terminalTarget = useTerminalTarget({ projectId, agentInstanceId });

  const optimisticRow = useOptimisticSessionRow({
    projectId,
    agentInstanceId,
    projectName,
    orgAgentId,
  });

  const handleSessionReady = useNewSessionUrlSync({
    setSearchParams,
    onSessionAdopted: optimisticRow.swap,
  });

  const { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession } =
    useChatStream({
      projectId,
      agentInstanceId,
      sessionId,
      onSessionReady: handleSessionReady,
    });

  const contextUsage = useContextUsage(streamKey);

  // Default-session redirect for the project route is owned by
  // `useConversationTarget` in `AgentChatRoute` so a single writer
  // controls `?session=`. Adding a duplicate redirect here used to
  // race with the resolver's writer, occasionally overwriting an
  // explicit row click with "most recent for instance".

  const historyKeyForFreshCanvas = useMemo(
    () => projectChatHistoryKey(projectId, agentInstanceId),
    [projectId, agentInstanceId],
  );

  const fresh = useFreshCanvas({
    projectId,
    agentInstanceId,
    orgAgentId,
    streamKey,
    sessionId,
    historyKey: sessionId
      ? sessionHistoryKey(projectId, agentInstanceId, sessionId)
      : historyKeyForFreshCanvas,
    setSearchParams,
    resetEvents,
    markNextSendAsNewSession,
  });

  // Clear the stream slot when navigating between two distinct
  // historical sessions.
  //
  // Phase 3: with `useStreamCore` keyed by `(projectId, agentInstanceId,
  // sessionId)`, a cross-session navigation also flips `streamKey`, so
  // the previous session's stream lane is no longer visible to this
  // panel and there is nothing to wipe — we just need to clear the
  // *new* session's lane back to the empty placeholder before the
  // history fetch repopulates it. The legacy `getIsStreaming(streamKey)`
  // bail-out is gone with per-session keys: an active turn in session A
  // can no longer leak deltas into session B's transcript regardless
  // of the panel's current selection.
  //
  // Two transitions still must NOT wipe:
  //   - `null → defined`: post-`SessionReady` URL flip after a
  //     fresh-canvas first send. The migration helper has already moved
  //     the in-flight events to the new key; resetting would clobber
  //     them.
  //   - `defined → null`: the new-chat path already clears via
  //     `useFreshCanvas`.
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const previous = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;
    if (previous === sessionId) return;
    if (previous === null || sessionId === null) return;
    resetEvents([], { allowWhileStreaming: true });
  }, [sessionId, resetEvents, streamKey]);

  const historyKey = useMemo(() => {
    if (fresh.freshCanvasPending) {
      return `fresh:${projectId}:${agentInstanceId}:${fresh.freshChatNonce}`;
    }
    if (sessionId) {
      return sessionHistoryKey(projectId, agentInstanceId, sessionId);
    }
    return projectChatHistoryKey(projectId, agentInstanceId);
  }, [projectId, agentInstanceId, sessionId, fresh.freshCanvasPending, fresh.freshChatNonce]);

  const fetchFn = useMemo(() => {
    if (fresh.freshCanvasPending) return EMPTY_SESSION_EVENTS_FETCH;
    if (sessionId) {
      return () => api.listSessionEvents(projectId, agentInstanceId, sessionId);
    }
    return () => api.getEvents(projectId, agentInstanceId);
  }, [projectId, agentInstanceId, sessionId, fresh.freshCanvasPending]);

  const onProjectSwitch = useCallback(() => {
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [projectId, agentInstanceId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const contextUsageFetcher = useMemo(
    () => (signal: AbortSignal) =>
      api.getContextUsage(projectId, agentInstanceId, { signal }),
    [projectId, agentInstanceId],
  );
  useHydrateContextUtilization(streamKey, contextUsageFetcher, agentInstanceId);

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } =
    useChatHistorySync({
      historyKey,
      streamKey,
      fetchFn,
      resetEvents,
      suppressHistoryFetch: fresh.freshCanvasPending,
      invalidateBeforeFetch: !!sessionId,
      onSwitch: onProjectSwitch,
      onClear,
      // (Phase B refactor) Hydration is implicit: the projector in
      // `useConversationSnapshot` reads `historyMessages` directly,
      // and the stream store carries only live (optimistic + in-flight
      // SSE) rows. Copying history into the stream store was the
      // legacy multi-source-of-truth merge that introduced the
      // post-stream "history clobbers stream" race the projector now
      // makes structurally impossible.
      watchAgentInstanceId: agentInstanceId,
      watchSessionId: sessionId ?? undefined,
      projectIdForSidekick: projectId,
    });

  const hasHistory = historyMessages.length > 0;
  const renameFromPrompt = useAutoRenameFromPrompt({
    projectId,
    agentInstanceId,
    agentName,
    hasHistory,
    sessionId,
  });

  const wrappedSend = useMemo(() => {
    const wrapped = wrapSend(sendMessage);
    const withOptimistic = optimisticRow.wrap(wrapped);
    return (...args: Parameters<typeof wrapped>): ReturnType<typeof wrapped> => {
      const content = typeof args[0] === "string" ? args[0] : "";
      renameFromPrompt(content);
      return withOptimistic(...args);
    };
  }, [wrapSend, sendMessage, optimisticRow, renameFromPrompt]);

  // Combine our own chat-SSE streaming state with automation-loop
  // activity against the same upstream agent. The harness rejects
  // overlapping turns server-side; this keeps the UI in sync.
  const busy = useAgentBusy({ projectId, agentInstanceId, streamKey });
  const loopOnlyBusy = busy.isBusy && busy.reason === "loop";
  const handleCombinedStop = useCallback(() => {
    if (loopOnlyBusy) {
      void api.stopLoop(projectId, agentInstanceId).catch((err) => {
        console.error("Failed to stop automation loop from chat", err);
      });
      return;
    }
    stopStreaming();
  }, [loopOnlyBusy, projectId, agentInstanceId, stopStreaming]);

  const deferredLoading = useDelayedLoading(isLoading);
  const panelKey = sessionId
    ? `${agentInstanceId}:${sessionId}`
    : fresh.freshCanvasPending
      ? `${agentInstanceId}:fresh:${fresh.freshChatNonce}`
      : agentInstanceId;
  const shouldUseCreateHandoff = initialCreateHandoff && !sessionId;

  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const showAgentSwitcher = projectAgents.length > 1;
  const mobileHeaderSummaryHint = agentName
    ? showAgentSwitcher
      ? `${projectAgents.length} agents in project`
      : machineType === "remote"
        ? "Remote"
        : "Local"
    : undefined;
  const openAgentPicker = useCallback(() => setAgentPickerOpen(true), []);
  const closeAgentPicker = useCallback(() => setAgentPickerOpen(false), []);
  const switchProjectAgent = useCallback(
    (nextAgentInstanceId: string) => {
      setAgentPickerOpen(false);
      setLastProject(projectId);
      setLastAgent(projectId, nextAgentInstanceId);
      navigate(`/projects/${projectId}/agents/${nextAgentInstanceId}`);
    },
    [navigate, projectId],
  );

  const panelProps: ChatPanelProps = {
    streamKey,
    transcriptKey: historyKey,
    onSend: wrappedSend,
    onStop: handleCombinedStop,
    isExternallyBusy: loopOnlyBusy,
    externalBusyMessage: loopOnlyBusy
      ? "This agent is running an automation task. Stop it to chat."
      : undefined,
    agentName,
    machineType,
    templateAgentId,
    adapterType,
    defaultModel,
    agentId: agentInstanceId,
    isLoading: deferredLoading,
    historyResolved,
    errorMessage: historyError ? historyError : null,
    initialHandoff: shouldUseCreateHandoff ? "create-agent" : undefined,
    onInitialHandoffReady,
    scrollResetKey: panelKey,
    historyMessages,
    projects: currentProject,
    selectedProjectId: projectId,
    // The projects-app pins the wire `project_id` to the route
    // project — same value as the picker. Threaded explicitly so
    // the chat panel can't accidentally swap in a different LLM
    // context project. See `useStandaloneAgentChat` for the
    // agents-app side that decouples picker from wire.
    llmProjectId: projectId,
    workspacePath: terminalTarget.workspacePath,
    remoteAgentId: terminalTarget.remoteAgentId,
    contextUsage,
    onNewChat: () => {
      optimisticRow.arm();
      fresh.newChat();
    },
  };

  return (
    <>
      {isMobileLayout ? (
        <MobileChatPanel
          {...panelProps}
          onMobileHeaderSummaryClick={showAgentSwitcher ? openAgentPicker : undefined}
          mobileHeaderSummaryHint={mobileHeaderSummaryHint}
          mobileHeaderSummaryLabel="Switch project agent"
          mobileHeaderSummaryKind={showAgentSwitcher ? "switch" : "details"}
        />
      ) : (
        <ChatPanel {...panelProps} />
      )}
      <ProjectAgentSwitcher
        isOpen={agentPickerOpen}
        isMobile={isMobileLayout}
        agents={projectAgents}
        currentAgentInstanceId={agentInstanceId}
        onClose={closeAgentPicker}
        onSwitchAgent={switchProjectAgent}
      />
    </>
  );
}
