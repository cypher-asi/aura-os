//! Wire-compatible mirrors of the harness's agent-permission model.
//!
//! These types are conceptually inbound (they're enforced on the harness
//! when a session is opened) but are large enough — and centrally important
//! enough to the protocol's "Agent permissions model" doc — that they live
//! in their own module. See the crate-level `Agent permissions model` doc
//! on `lib.rs` for context.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::common::ToolStateWire;

/// Wire-compatible mirror of `aura_core::AgentToolPermissions`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentToolPermissionsWire {
    #[serde(default)]
    pub per_tool: BTreeMap<String, ToolStateWire>,
}

/// Wire-compatible mirror of `aura_core::AgentPermissions`.
///
/// Mirrored here so `aura-protocol` stays decoupled from the harness-core
/// crates; the harness translates [`AgentPermissionsWire`] into its own
/// `aura_core::AgentPermissions` at `SessionInit` time. Additive /
/// forward-compatible: unknown capability variants deserialize into
/// [`CapabilityWire::Unknown`] rather than rejecting the session.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentPermissionsWire {
    #[serde(default)]
    pub scope: AgentScopeWire,
    #[serde(default)]
    pub capabilities: Vec<CapabilityWire>,
}

/// Wire-compatible mirror of `aura_core::AgentScope`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentScopeWire {
    #[serde(default)]
    pub orgs: Vec<String>,
    #[serde(default)]
    pub projects: Vec<String>,
    #[serde(default)]
    pub agent_ids: Vec<String>,
}

/// Wire-compatible mirror of `aura_core::Capability` (externally-tagged
/// camel-case enum matching the core serialization format).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub enum CapabilityWire {
    SpawnAgent,
    ControlAgent,
    ReadAgent,
    ManageOrgMembers,
    ManageBilling,
    InvokeProcess,
    PostToFeed,
    GenerateMedia,
    #[serde(rename_all = "camelCase")]
    ReadProject {
        id: String,
    },
    #[serde(rename_all = "camelCase")]
    WriteProject {
        id: String,
    },
    /// Wildcard read access over every project in the bundle's scope.
    /// Satisfies any `ReadProject { id }` requirement without having to
    /// enumerate ids. Used by the CEO preset so the unified tool-surface
    /// filter can drop the old `is_ceo_preset()` short-circuit.
    ReadAllProjects,
    /// Wildcard write access over every project in the bundle's scope.
    /// Strict superset of [`ReadAllProjects`]; satisfies any
    /// `WriteProject { id }` requirement (and, by the write-implies-read
    /// rule, any `ReadProject { id }` requirement too).
    WriteAllProjects,
    /// Forward-compat fallback for capabilities introduced after this
    /// protocol version. Deserialized via `#[serde(other)]` so a newer
    /// harness / server can round-trip older wire bundles without
    /// rejecting the session. Producers should never emit this variant.
    #[serde(other)]
    Unknown,
}

#[cfg(test)]
mod capability_wire_tests {
    use super::*;

    #[test]
    fn capability_wire_unknown_variant_round_trips_as_unknown() {
        let json = r#"{"type":"futureCapability"}"#;
        let c: CapabilityWire = serde_json::from_str(json).unwrap();
        assert!(matches!(c, CapabilityWire::Unknown));
    }

    #[test]
    fn capability_wire_known_variants_still_deserialize() {
        let spawn: CapabilityWire = serde_json::from_str(r#"{"type":"spawnAgent"}"#).unwrap();
        assert!(matches!(spawn, CapabilityWire::SpawnAgent));
        let read_project: CapabilityWire =
            serde_json::from_str(r#"{"type":"readProject","id":"proj-1"}"#).unwrap();
        assert!(matches!(
            read_project,
            CapabilityWire::ReadProject { ref id } if id == "proj-1"
        ));
    }

    #[test]
    fn agent_permissions_with_unknown_capability_deserializes() {
        // An older server receiving a newer bundle must accept the
        // session rather than fail deserialization.
        let json = r#"{
            "scope": { "orgs": [], "projects": [], "agent_ids": [] },
            "capabilities": [
                {"type": "spawnAgent"},
                {"type": "someFutureCapability", "extra": "ignored"}
            ]
        }"#;
        let perms: AgentPermissionsWire = serde_json::from_str(json).unwrap();
        assert_eq!(perms.capabilities.len(), 2);
        assert!(matches!(perms.capabilities[0], CapabilityWire::SpawnAgent));
        assert!(matches!(perms.capabilities[1], CapabilityWire::Unknown));
    }
}
