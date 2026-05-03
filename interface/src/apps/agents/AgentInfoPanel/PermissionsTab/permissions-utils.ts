import {
  fullAccessAgentPermissions,
  type AgentPermissions,
  type AgentScope,
  type Capability,
} from "../../../../shared/types/permissions-wire";

export type ScopeAxis = "orgs" | "projects" | "agent_ids";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/**
 * Debounce window between a toggle flip and the PUT that persists it.
 * Keeps the save count proportional to what the user did — rapid
 * on/off flicker coalesces into a single request — without making the
 * "saved" indicator feel sluggish.
 */
export const AUTOSAVE_DEBOUNCE_MS = 350;

/**
 * How long the transient "Saved" badge stays visible after a
 * successful autosave before fading back to the idle state.
 */
export const SAVED_INDICATOR_MS = 1500;

export function shortenId(id: string): string {
  if (id.length <= 9) return id;
  return `${id.slice(0, 8)}…`;
}

export function sortedScope(scope: AgentScope): AgentScope {
  return {
    orgs: [...scope.orgs].sort(),
    projects: [...scope.projects].sort(),
    agent_ids: [...scope.agent_ids].sort(),
  };
}

export function capabilityKey(cap: Capability): string {
  if (cap.type === "readProject" || cap.type === "writeProject") {
    return `${cap.type}:${cap.id}`;
  }
  return cap.type;
}

export function sortedCapabilities(caps: Capability[]): Capability[] {
  return [...caps].sort((a, b) => capabilityKey(a).localeCompare(capabilityKey(b)));
}

export function permissionsEqual(
  a: AgentPermissions | undefined,
  b: AgentPermissions | undefined,
): boolean {
  const aa = a ?? fullAccessAgentPermissions();
  const bb = b ?? fullAccessAgentPermissions();
  const sa = sortedScope(aa.scope);
  const sb = sortedScope(bb.scope);
  if (
    sa.orgs.length !== sb.orgs.length ||
    sa.projects.length !== sb.projects.length ||
    sa.agent_ids.length !== sb.agent_ids.length
  ) {
    return false;
  }
  for (let i = 0; i < sa.orgs.length; i++) if (sa.orgs[i] !== sb.orgs[i]) return false;
  for (let i = 0; i < sa.projects.length; i++)
    if (sa.projects[i] !== sb.projects[i]) return false;
  for (let i = 0; i < sa.agent_ids.length; i++)
    if (sa.agent_ids[i] !== sb.agent_ids[i]) return false;
  const ca = sortedCapabilities(aa.capabilities).map(capabilityKey);
  const cb = sortedCapabilities(bb.capabilities).map(capabilityKey);
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return false;
  return true;
}
