import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAgents } from "../../stores";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useChatHandoffStore } from "../../../../stores/chat-handoff-store";
import { standaloneAgentHandoffTarget } from "../../../../utils/chat-handoff";

/**
 * Route element shared by `/agents/:agentId` and
 * `/projects/:projectId/agents/:agentInstanceId`.
 *
 * The agent chat is no longer rendered here. It lives in the shell-level
 * `ConversationSurfaceHost`, a single persistent surface keyed by conversation
 * lane so switching between the Agents and Projects apps on the same
 * agent/session never remounts the chat. This element therefore renders
 * nothing — its only job is to make the route match so the host (which derives
 * the target from the URL) takes over while the app's `MainPanel` wraps an
 * empty outlet.
 *
 * It does own one piece of routing logic: stale-agent recovery for the
 * standalone `/agents/:agentId` form. A cached last-agent id that belongs to a
 * different (logged-out) user, a deleted agent, or a dead deep link would
 * otherwise strand the user on `/agents/<deadId>` — an unhighlighted sidebar
 * and an empty "Select an agent" sidekick that reads as "no agent is
 * selected". When the fleet has loaded and the id doesn't resolve, we bounce
 * back to `/agents` so `AgentIndexRedirect` clears the stale id and selects a
 * real agent.
 */
export function AgentChatRoute(): null {
  const { agentId } = useParams();
  const { agents, status } = useAgents();
  const { remoteOnly } = useAuraCapabilities();
  const pendingCreateAgentHandoff = useChatHandoffStore(
    (s) => s.pendingCreateAgentHandoff,
  );
  const navigate = useNavigate();

  // Only fires on the standalone `/agents/:agentId` route (`agentId` is
  // undefined on the project route, whose param is `agentInstanceId`). Gated
  // on `ready` so a transient `idle`/`loading`/`error` fleet never triggers a
  // bounce (which could loop). When the current runtime can't reach local
  // agents, a direct deep link to one is treated as not viewable and bounces
  // too.
  const resolvedAgent =
    agentId != null ? agents.find((a) => a.agent_id === agentId) : undefined;
  const agentMissing =
    agentId != null &&
    status === "ready" &&
    (resolvedAgent == null ||
      (remoteOnly && resolvedAgent.machine_type === "local"));

  // A just-created agent isn't in the fleet snapshot until the forced refetch
  // lands (a `force` refetch keeps `status: "ready"` throughout), so guard the
  // create handoff to avoid bouncing the user away from their new agent.
  const isPendingCreate =
    agentId != null &&
    pendingCreateAgentHandoff?.target === standaloneAgentHandoffTarget(agentId);

  useEffect(() => {
    if (agentMissing && !isPendingCreate) {
      navigate("/agents", { replace: true });
    }
  }, [agentMissing, isPendingCreate, navigate]);

  return null;
}
