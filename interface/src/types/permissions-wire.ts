/**
 * TypeScript mirrors of `aura_protocol::AgentPermissionsWire`,
 * `AgentScopeWire`, and `CapabilityWire` (plus the companion
 * `IntentClassifierSpec` / `IntentClassifierRule`). Field shapes are kept
 * byte-identical to the JSON emitted by the Rust types so the interface
 * can round-trip permissions bundles through the `/api/agents` endpoints
 * without any translation layer.
 *
 * The Rust source of truth:
 *   - `crates/aura-protocol/src/lib.rs`
 *   - `crates/aura-os-core/src/permissions.rs`
 *
 * Notes on the JSON shape:
 *   - `AgentScope` serializes its fields untouched, so the wire key is
 *     `agent_ids` (snake_case), not `agentIds`.
 *   - `Capability` is an externally-tagged enum with `rename_all = "camelCase"`.
 *     The variant tag therefore lives under the `type` field with camel-case
 *     values like `"spawnAgent"`, `"readProject"`, etc.
 *   - `Capability::ReadProject { id }` / `WriteProject { id }` serialize as
 *     `{ "type": "readProject", "id": "..." }`.
 */

export interface AgentScope {
  orgs: string[];
  projects: string[];
  agent_ids: string[];
}

export type Capability =
  | { type: "spawnAgent" }
  | { type: "controlAgent" }
  | { type: "readAgent" }
  | { type: "manageOrgMembers" }
  | { type: "manageBilling" }
  | { type: "invokeProcess" }
  | { type: "postToFeed" }
  | { type: "generateMedia" }
  | { type: "readProject"; id: string }
  | { type: "writeProject"; id: string }
  | { type: "readAllProjects" }
  | { type: "writeAllProjects" };

export interface AgentPermissions {
  scope: AgentScope;
  capabilities: Capability[];
}

export interface IntentClassifierRule {
  domain: string;
  keywords: string[];
}

export interface IntentClassifierSpec {
  tier1_domains: string[];
  classifier_rules: IntentClassifierRule[];
  tool_domains?: Record<string, string>;
}

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
  "manageOrgMembers",
  "manageBilling",
  "invokeProcess",
  "postToFeed",
  "generateMedia",
  "readAllProjects",
  "writeAllProjects",
] as const satisfies ReadonlyArray<Capability["type"]>;
