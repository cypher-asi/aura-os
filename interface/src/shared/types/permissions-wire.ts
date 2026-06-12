import type { AgentPermissionsWire } from "./generated/protocol/AgentPermissionsWire";
import type { AgentScopeWire } from "./generated/protocol/AgentScopeWire";
import type { CapabilityWire } from "./generated/protocol/CapabilityWire";
import type { IntentClassifierRule as IntentClassifierRuleWire } from "./generated/protocol/IntentClassifierRule";
import type { IntentClassifierSpec as IntentClassifierSpecWire } from "./generated/protocol/IntentClassifierSpec";

export type AgentScope = AgentScopeWire;
export type Capability = Exclude<CapabilityWire, { type: "unknown" }>;

/**
 * Tri-state per-tool permission value. Mirrors the Rust
 * `ToolStateWire` ("on" / "off" / "ask") used by both the persisted
 * agent record and the harness session wire.
 */
export type ToolPermissionState = "on" | "off" | "ask";

/**
 * Per-tool overrides persisted on `agent.permissions`. A tool with no
 * entry defaults to "on", so an empty map means every default tool is
 * enabled — the starting state for all agents.
 */
export interface AgentToolPermissions {
  per_tool: Record<string, ToolPermissionState>;
}

export type AgentPermissions = Omit<AgentPermissionsWire, "capabilities"> & {
  capabilities: Capability[];
  /**
   * Per-tool tri-state overrides. Absent / empty means "everything
   * on". Serialized by the server only when at least one override is
   * stored (`skip_serializing_if` on the Rust side).
   */
  tool_permissions?: AgentToolPermissions;
};
export type IntentClassifierRule = IntentClassifierRuleWire;
export type IntentClassifierSpec = Omit<
  IntentClassifierSpecWire,
  "tool_domains"
> & {
  tool_domains?: Record<string, string>;
};

export function emptyAgentScope(): AgentScope {
  return { orgs: [], projects: [], agent_ids: [] };
}

export function emptyAgentPermissions(): AgentPermissions {
  return { scope: emptyAgentScope(), capabilities: [] };
}

/**
 * Capability variants that participate in the CEO preset (universe scope +
 * every core capability). Must stay in sync with
 * `AgentPermissions::ceo_preset` in `crates/aura-os-core/src/permissions.rs`.
 */
export const CEO_CORE_CAPABILITY_TYPES = [
  "spawnAgent",
  "controlAgent",
  "readAgent",
  "listAgents",
  "manageOrgMembers",
  "manageBilling",
  "invokeProcess",
  "postToFeed",
  "generateMedia",
  "readAllProjects",
  "writeAllProjects",
] as const satisfies ReadonlyArray<Capability["type"]>;

export function fullAccessAgentPermissions(): AgentPermissions {
  return {
    scope: emptyAgentScope(),
    capabilities: CEO_CORE_CAPABILITY_TYPES.map((type) => ({ type })),
  };
}
