import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import type { ConversationTarget } from "./use-conversation-target";

/**
 * Pure, render-time parse of the router location into the inputs the
 * conversation-target resolver expects. Lives as a standalone derivation so
 * the shell-level `ConversationSurfaceHost` (mounted ABOVE the route outlet)
 * can drive the agent chat without depending on `useParams`, which only sees
 * params matched up to the host's own route position.
 *
 * Recognised conversation surfaces:
 *   - `/agents/:agentId`                              (standalone agents shell)
 *   - `/projects/:projectId/agents/:agentInstanceId`  (project-scoped chat)
 */
export type ConversationRouteParams = {
  isConversationRoute: boolean;
  projectId?: string;
  agentInstanceId?: string;
  agentId?: string;
  sessionId: string | null;
  queryProjectId: string | null;
  queryInstanceId: string | null;
};

const NON_INSTANCE_AGENT_SEGMENTS = new Set(["create", "attach"]);

export function parseConversationRoute(
  pathname: string,
  search: string,
): ConversationRouteParams {
  const params = new URLSearchParams(search);
  const sessionId = params.get("session");
  const queryProjectId = params.get("project");
  const queryInstanceId = params.get("instance");
  const standaloneView = params.get("view");
  const base = { sessionId, queryProjectId, queryInstanceId } as const;

  const segments = pathname.split("/").filter(Boolean);

  // `/agents/:agentId` — exactly two segments, the agents shell chat.
  if (
    segments[0] === "agents"
    && segments.length === 2
    && standaloneView !== "details"
  ) {
    return { ...base, isConversationRoute: true, agentId: segments[1] };
  }

  // `/projects/:projectId/agents/:agentInstanceId` — the canonical
  // project-scoped chat. Excludes the list (`/agents`), setup
  // (`/agents/create`, `/agents/attach`), and details
  // (`/agents/:id/details`) surfaces, which are not chat lanes.
  if (
    segments[0] === "projects" &&
    segments.length === 4 &&
    segments[2] === "agents" &&
    !NON_INSTANCE_AGENT_SEGMENTS.has(segments[3])
  ) {
    return {
      ...base,
      isConversationRoute: true,
      projectId: segments[1],
      agentInstanceId: segments[3],
    };
  }

  return { ...base, isConversationRoute: false };
}

export function useConversationRouteParams(): ConversationRouteParams {
  const { pathname, search } = useLocation();
  return useMemo(() => parseConversationRoute(pathname, search), [pathname, search]);
}

/**
 * Mount identity for the chat surface. Keyed by the conversation LANE
 * (`projectId` + `agentInstanceId`) rather than the session id so that:
 *
 *   - Switching apps (Agents <-> Projects) onto the same lane keeps the exact
 *     same `AgentChatPanel` element mounted — no remount, no refetch.
 *   - In-lane session changes (clicking a history row, the post-send
 *     `null -> sessionId` URL flip) are prop updates the panel already handles
 *     internally, so they must NOT change the key.
 *
 * A different agent instance is a genuinely different conversation and gets a
 * new key (intentional remount).
 */
export function conversationLaneKey(target: ConversationTarget): string {
  switch (target.kind) {
    case "ready":
      return `lane:${target.projectId}:${target.agentInstanceId}`;
    case "empty":
      return `empty:${target.agentId}`;
    case "pending":
      return "pending";
  }
}
