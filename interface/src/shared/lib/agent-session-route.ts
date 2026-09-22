export interface AgentSessionRouteIdentity {
  projectId?: string | null;
  agentInstanceId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
}

/**
 * Build the canonical Aura route for an agent-owned session.
 *
 * Project-bound instances use the project chat lane. Events that only carry
 * the persistent agent identity fall back to the Agents shell while retaining
 * any project/instance hints that can help the resolver recover the same lane.
 */
export function buildAgentSessionRoute({
  projectId,
  agentInstanceId,
  agentId,
  sessionId,
}: AgentSessionRouteIdentity): string | undefined {
  const project = cleanId(projectId);
  const instance = cleanId(agentInstanceId);
  const agent = cleanId(agentId);
  const session = cleanId(sessionId);

  if (project && instance) {
    return appendSession(
      `/projects/${encodeURIComponent(project)}/agents/${encodeURIComponent(instance)}`,
      session,
    );
  }

  if (!agent) return undefined;
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (instance) params.set("instance", instance);
  if (session) params.set("session", session);
  const query = params.toString();
  return `/agents/${encodeURIComponent(agent)}${query ? `?${query}` : ""}`;
}

function appendSession(path: string, sessionId: string | undefined): string {
  if (!sessionId) return path;
  const params = new URLSearchParams({ session: sessionId });
  return `${path}?${params.toString()}`;
}

function cleanId(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}
