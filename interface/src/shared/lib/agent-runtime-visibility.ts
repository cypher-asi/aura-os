/**
 * Runtime visibility rules for "local" agents.
 *
 * Local agents (`machine_type === "local"`) run on the user's own
 * machine and can only be reached when a desktop bridge is present
 * (`window.ipc`). On the web / mobile clients there is no bridge
 * (`remoteOnly === true`), so local agents can't be used and must be
 * hidden from every list/picker and blocked from creation.
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
 * Drop local agents when `remoteOnly` (no desktop bridge). Returns the
 * input untouched otherwise so desktop keeps its full fleet. Works for
 * both `Agent` and `AgentInstance` since both carry `machine_type`.
 */
export function filterRuntimeVisibleAgents<T extends { machine_type?: string | null }>(
  agents: readonly T[],
  remoteOnly: boolean,
): T[] {
  return remoteOnly ? agents.filter((agent) => !isLocalAgent(agent)) : [...agents];
}
