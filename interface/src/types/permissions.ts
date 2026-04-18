import type { Agent } from "./entities";
import {
  CEO_CORE_CAPABILITY_TYPES,
  type AgentPermissions,
  type Capability,
} from "./permissions-wire";

/**
 * True iff an agent's permissions bundle spans the entire universe (empty
 * scope on every axis) and carries every core CEO capability. This is the
 * single source of truth for detecting super-agents (a.k.a. CEO agents) in
 * the interface — never branch on `role` or `tags`.
 */
export function isSuperAgent(agent: Agent): boolean {
  return (
    hasUniverseScope(agent.permissions) &&
    hasAllCoreCapabilities(agent.permissions)
  );
}

export function hasUniverseScope(perms: AgentPermissions | undefined): boolean {
  if (!perms) return false;
  const s = perms.scope;
  return (
    (s?.orgs?.length ?? 0) === 0 &&
    (s?.projects?.length ?? 0) === 0 &&
    (s?.agent_ids?.length ?? 0) === 0
  );
}

export function hasAllCoreCapabilities(
  perms: AgentPermissions | undefined,
): boolean {
  if (!perms) return false;
  const present = new Set(perms.capabilities.map((c) => c.type));
  return CEO_CORE_CAPABILITY_TYPES.every((t) => present.has(t));
}

function hasCapabilityType(
  perms: AgentPermissions | undefined,
  type: Capability["type"],
): boolean {
  return !!perms?.capabilities.some((c) => c.type === type);
}

export function hasSpawnCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "spawnAgent");
}

export function hasControlAgentCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "controlAgent");
}

export function hasReadAgentCapability(
  perms: AgentPermissions | undefined,
): boolean {
  return hasCapabilityType(perms, "readAgent");
}
