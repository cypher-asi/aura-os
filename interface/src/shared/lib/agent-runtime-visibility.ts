/**
 * Runtime visibility rules for "local" agents.
 *
 * Local agents (`machine_type === "local"`) run on Aura's local-harness
 * runtime. That is normally the desktop sidecar, but web deployments can
 * enable it through a protected hosted harness. When `remoteOnly === true`,
 * local agents cannot be used and must be hidden from every list/picker and
 * blocked from creation.
 *
 * Centralized here so the dozens of surfaces that render agents or
 * agent instances apply the exact same predicate and can't drift —
 * the bug this fixes was each surface re-deriving the rule (or
 * forgetting it entirely).
 */

/** True when the entity is a local-machine agent / agent instance. */
export function isLocalAgent(entity: { machine_type?: string | null }): boolean {
  return entity.machine_type === "local";
}

/**
 * Drop local agents when `remoteOnly`. Returns the input untouched otherwise
 * so desktop and hosted-harness web deployments keep the full fleet. Works
 * for both `Agent` and `AgentInstance` since both carry `machine_type`.
 */
export function filterRuntimeVisibleAgents<T extends { machine_type?: string | null }>(
  agents: readonly T[],
  remoteOnly: boolean,
): T[] {
  return remoteOnly ? agents.filter((agent) => !isLocalAgent(agent)) : [...agents];
}
