import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { ChatPanel, type ChatPanelProps } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { useAgents, useSelectedAgent } from "../../../agents/stores";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useSessionsListStore } from "../../../../stores/sessions-list-store";
import type { Agent } from "../../../../shared/types";
import { setLastChatRoute } from "../../../../utils/storage";
import { useChatAppAgent } from "../../hooks/use-chat-app-agent";
import { useChatAppChat } from "../../hooks/use-chat-app-chat";
import { useChatAppSessions } from "../../hooks/use-chat-app-sessions";
import { useImportPublicChatsOnAuth } from "../../hooks/use-public-chat-import";

/**
 * Top-level Chat app route. Resolves the canonical chat agent via
 * `useChatAppAgent` (which calls the idempotent
 * `POST /api/agents/harness/setup` and caches the result for the app
 * session) for the empty-canvas case, and falls through to the
 * URL-provided / session-derived agent for cross-agent conversations
 * surfaced from the left panel.
 *
 * - `/chat`
 *     -> fresh canvas (next send creates a session on the CEO agent).
 * - `/chat?session=<id>` (legacy)
 *     -> looks the session up in the merged cross-agent list and
 *        opens it against its owning agent (derived via
 *        `bindingsByAgent`).
 * - `/chat?agent=<aid>&project=<pid>&instance=<iid>&session=<sid>`
 *     -> the canonical form written by `ChatAppLeftPanel`; mounts the
 *        right `ChatPanel` before the merged session list has loaded.
 *
 * The sidekick (mounted via `ChatApp.SidekickPanel = AgentInfoPanel`)
 * reads its agent from `useSelectedAgent()`, so the effective agent is
 * mirrored into that slot here — the sidekick automatically re-renders
 * the right profile / chats / skills / memory tabs for whichever
 * agent owns the active conversation.
 */
export function ChatAppRoute() {
  const { agents } = useAgents();
  const { setSelectedAgent } = useSelectedAgent();
  const { isMobileLayout, remoteOnly } = useAuraCapabilities();
  const { agent: chatAgent, status, error } = useChatAppAgent({ remoteOnly });
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const searchParamString = searchParams.toString();
  const freshChatId = searchParams.get("fresh");
  const agentIdParam = searchParams.get("agent");
  const projectIdParam = searchParams.get("project");
  const agentInstanceIdParam = searchParams.get("instance");
  const { sessions } = useChatAppSessions(agents);
  const freshCanvasPending = !sessionId;
  useImportPublicChatsOnAuth(chatAgent);

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) map.set(a.agent_id, a);
    return map;
  }, [agents]);

  const bindingsByAgent = useSessionsListStore((s) => s.bindingsByAgent);

  // `project_agent_id` -> owning `Agent` map, sourced from each
  // agent's server-authoritative bindings (`bindingsByAgent` is
  // populated by `loadAgentSessions` and includes the auto-created
  // Home project, which `useProjectsListStore` may not surface for
  // remote agents). Used to resolve the legacy `/chat?session=<id>`
  // form into the right agent. Memoized so unrelated store updates
  // (e.g. `sessionsBySurface` writes for other agents) don't churn
  // every render here.
  const agentByInstance = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) {
      const bindings = bindingsByAgent[a.agent_id];
      if (!bindings) continue;
      for (const b of bindings) map.set(b.project_agent_id, a);
    }
    return map;
  }, [agents, bindingsByAgent]);

  // Effective agent resolution order:
  //   1. `?agent=<id>` (written by `ChatAppLeftPanel`) — wins so the
  //      chat panel mounts the right agent before the merged session
  //      list has loaded.
  //   2. `?session=<id>` (legacy / shared-link form) — look the
  //      session up in the merged cross-agent list and use the agent
  //      that owns its `_agentInstanceId` per `bindingsByAgent`.
  //   3. Fallback to the canonical CEO chat agent so `/chat` (no
  //      params) keeps the fresh-canvas it always did.
  const effectiveAgent = useMemo<Agent | null>(() => {
    if (agentIdParam) {
      const fromUrl = agentById.get(agentIdParam);
      if (fromUrl) return fromUrl;
    }
    if (sessionId) {
      const session = sessions.find((s) => s.session_id === sessionId);
      if (session) {
        const owner = agentByInstance.get(session._agentInstanceId);
        if (owner) return owner;
      }
    }
    return chatAgent;
  }, [agentIdParam, agentById, sessionId, sessions, agentByInstance, chatAgent]);

  // The agent id the chat surface actually fetches events under.
  // `?agent=<id>` is written by `ChatAppLeftPanel` straight from the
  // session row's server-authoritative `_agentId`, so it is the
  // source of truth even when that agent isn't in the active-org
  // `useAgents()` snapshot (`agentById` misses it). Resolving the
  // chat fetch off `effectiveAgent?.agent_id` instead would fall back
  // to `chatAgent` for any out-of-org session and 404 the per-session
  // events read ("session not found") because the session belongs to
  // a different agent. Honour `agentIdParam` first; fall back to the
  // resolved `Agent` (legacy `?session=` form / fresh canvas).
  const effectiveAgentId = agentIdParam ?? effectiveAgent?.agent_id;

  useEffect(() => {
    if (!sessionId) return;
    const session = sessions.find((s) => s.session_id === sessionId);
    const projectId = projectIdParam ?? session?._projectId;
    const agentInstanceId = agentInstanceIdParam ?? session?._agentInstanceId;
    if (!projectId || !agentInstanceId) return;

    const next = new URLSearchParams(searchParamString);
    next.delete("fresh");
    next.set("project", projectId);
    next.set("instance", agentInstanceId);
    next.set("session", sessionId);
    const agentId =
      next.get("agent") ??
      session?._agentId ??
      (session ? agentByInstance.get(agentInstanceId)?.agent_id : null);
    if (!agentId) return;
    next.set("agent", agentId);
    setLastChatRoute(`/chat?${next.toString()}`);
  }, [
    agentIdParam,
    agentInstanceIdParam,
    agentByInstance,
    projectIdParam,
    searchParamString,
    sessionId,
    sessions,
  ]);

  // Mirror the effective agent into the shared selected-agent slot so
  // the sidekick (`AgentInfoPanel` / `AgentSidekickTaskbar`) renders
  // the right agent's profile, memory, skills, etc. for every
  // selected conversation. Prefer the URL agent id even before its
  // `Agent` object lands in the store (the left panel hydrates it in
  // the background) so the sidekick converges on the right agent.
  useEffect(() => {
    const selectedId = effectiveAgentId ?? effectiveAgent?.agent_id;
    if (selectedId) {
      setSelectedAgent(selectedId);
    }
  }, [effectiveAgentId, effectiveAgent, setSelectedAgent]);

  // A fresh route is claimed only by the `SessionReady` event delivered
  // through `useStandaloneAgentChat`. Never infer its identity from the
  // cross-agent session list: another tab or a private council member can
  // legitimately create a newer row while this request is in flight.
  const chatOptions = useMemo(
    () =>
      ({
        freshCanvasPending,
        ...(freshChatId != null ? { freshCanvasKey: freshChatId } : {}),
      }),
    [freshCanvasPending, freshChatId],
  );

  const sharedChatProps = useChatAppChat(
    effectiveAgentId,
    sessionId,
    chatOptions,
  );

  // Pre-resolve panel props so the chat surface can mount on the very
  // first paint, even before `useChatAppAgent()` has finished talking
  // to `POST /api/agents/harness/setup`. The hook seeds the cached
  // chat agent from the warm `useAgentStore.agents` slot + persisted
  // last-resolved id so the typical case here is `effectiveAgent !=
  // null` immediately. The remaining cold-cache path (very first ever
  // visit, or a wipe of localStorage + agents-list cache) flows
  // through the `historyResolved` short-circuit below: we render the
  // panel chrome with an empty transcript (no loading hint) so the user
  // sees the familiar surface instead of a centered PageEmptyState that
  // swaps out the entire route.
  const panelProps: ChatPanelProps = effectiveAgent
    ? { ...sharedChatProps, scrollToBottomOnReset: false }
    : {
        ...sharedChatProps,
        scrollToBottomOnReset: false,
        sendDisabled: effectiveAgentId ? sharedChatProps.sendDisabled : true,
        sendDisabledReason: effectiveAgentId
          ? sharedChatProps.sendDisabledReason
          : "Starting chat...",
        // `useStandaloneAgentChat` returns `historyResolved: false`
        // when no agentId is set; flip to `true` so the panel skips
        // the cold-load reveal cycle and the empty-state slot below
        // takes over instead.
        historyResolved: true,
        isLoading: false,
        emptyMessage: status === "error"
          ? error ?? "Couldn't start chat. Try again in a moment."
          : undefined,
      };

  // Hard error fallback — shown only when there is genuinely nothing
  // to chat with (no warm seed AND `setup()` has failed). The hook
  // surfaces `status === "error"` only after both have struck out; in
  // every other case the panel chrome stays mounted (with an empty
  // transcript) so the user still sees their input bar / sidekick
  // chrome instead of a centered route swap.
  if (!effectiveAgent && status === "error") {
    return (
      <PageEmptyState
        title="Couldn't start chat"
        description={error ?? "Try again in a moment."}
      />
    );
  }

  return isMobileLayout ? (
    <MobileChatPanel {...panelProps} />
  ) : (
    <ChatPanel {...panelProps} />
  );
}
