import { Navigate } from "react-router-dom";
import { Bot, Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { EmptyState } from "../../../components/EmptyState";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { clearLastStandaloneAgentId, getLastStandaloneAgentId } from "../../../utils/storage";
import { useAgents, useSortedAgents, warmStandaloneAgentHistory } from "../stores";

export function AgentIndexRedirect() {
  const { agents, status } = useAgents();
  const sortedAgents = useSortedAgents();
  const { isMobileLayout, remoteOnly } = useAuraCapabilities();

  // Fast path: if we have a cached last-used agent id, redirect before
  // the `fetchAgents` network round-trip even completes — the downstream
  // chat view loads its own history in parallel with the agent list, so
  // there's no reason to gate first paint on the list coming back.
  //
  // We only honour the cached id optimistically while the fleet is still
  // loading. Once the list is ready we require the id to resolve to a real
  // agent before redirecting; otherwise (a different user logged in, or the
  // agent was deleted) the id would send the user to `/agents/<deadId>` —
  // an unhighlighted sidebar + an empty "Select an agent" sidekick that
  // reads as "no agent is selected". In that case we clear the stale id and
  // fall through to the first sorted agent.
  const lastId = isMobileLayout ? null : getLastStandaloneAgentId();
  const isFleetReady = status === "ready" || status === "error";
  // When the current runtime can't reach local agents, a cached id pointing at
  // one must not resolve — fall through to the first visible remote-capable
  // agent.
  const lastIdResolves =
    lastId != null &&
    agents.some(
      (a) =>
        a.agent_id === lastId && !(remoteOnly && a.machine_type === "local"),
    );
  if (lastId && (!isFleetReady || lastIdResolves)) {
    // Warm the destination history now so the chat surface doesn't flash its
    // cold-load gate when it mounts a moment from now.
    warmStandaloneAgentHistory(lastId);
    return <Navigate to={`/agents/${lastId}`} replace />;
  }
  if (lastId && isFleetReady && !lastIdResolves) {
    clearLastStandaloneAgentId();
  }

  if (status === "idle" || status === "loading") {
    return (
      <PageEmptyState
        icon={<Loader2 size={32} className="animate-spin" aria-hidden />}
        title="Loading agents…"
      />
    );
  }

  if (isMobileLayout && agents.length > 0) {
    return (
      <EmptyState icon={<Bot size={32} />}>
        Select an agent from your library.
      </EmptyState>
    );
  }

  // `lastId` wasn't set (or was cleared above because the backing agent
  // no longer exists): fall back to the first sorted agent.
  if (getLastStandaloneAgentId()) {
    clearLastStandaloneAgentId();
  }

  const target = sortedAgents[0];
  if (target) {
    warmStandaloneAgentHistory(target.agent_id);
    return <Navigate to={`/agents/${target.agent_id}`} replace />;
  }

  return <EmptyState icon={<Bot size={32} />}>Create your first AI agent to start chatting, automating tasks, and more.</EmptyState>;
}
