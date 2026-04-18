//! Agent permission primitives for aura-os.
//!
//! Mirrors `aura_core::permissions` in the `aura-harness` repo so the
//! rest of the aura-os workspace can import [`AgentPermissions`],
//! [`AgentScope`], and [`Capability`] from a single local path.
//!
//! # Choice of duplication over re-export
//!
//! The authoritative definitions live in `aura-harness` but that crate
//! is not a dependency of this workspace — [`aura_protocol`] carries a
//! wire-compatible mirror (`AgentPermissionsWire` etc.) used by
//! `SessionInit`. We keep a full native mirror here rather than using
//! the wire types directly so aura-os business code can manipulate
//! `Vec<Capability>` without going through `serde_json`, and so the
//! `Agent` struct remains free of wire-level concerns. Conversions to
//! and from the wire shape are `From` impls below and are used
//! wherever aura-os talks to the harness (e.g. `SessionConfig`).
//!
//! The serde representation is byte-identical to
//! `aura_protocol::AgentPermissionsWire`, so JSON round-trips between
//! the harness wire and this local type are transparent.

use serde::{Deserialize, Serialize};

use aura_protocol::{AgentPermissionsWire, AgentScopeWire, CapabilityWire};

/// Capabilities an agent can hold. Enforced by the harness against the
/// `SessionInit.agent_permissions` bundle shipped by the caller.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Capability {
    SpawnAgent,
    ControlAgent,
    ReadAgent,
    ManageOrgMembers,
    ManageBilling,
    InvokeProcess,
    PostToFeed,
    GenerateMedia,
    #[serde(rename_all = "camelCase")]
    ReadProject { id: String },
    #[serde(rename_all = "camelCase")]
    WriteProject { id: String },
}

/// Orgs / projects / agents an agent may touch. Empty on every axis
/// means universe (no restriction).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentScope {
    #[serde(default)]
    pub orgs: Vec<String>,
    #[serde(default)]
    pub projects: Vec<String>,
    #[serde(default)]
    pub agent_ids: Vec<String>,
}

impl AgentScope {
    #[must_use]
    pub fn is_universe(&self) -> bool {
        self.orgs.is_empty() && self.projects.is_empty() && self.agent_ids.is_empty()
    }
}

/// Scope + capabilities bundle attached to an agent record.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPermissions {
    #[serde(default)]
    pub scope: AgentScope,
    #[serde(default)]
    pub capabilities: Vec<Capability>,
}

impl AgentPermissions {
    /// Fully permissive preset used for bootstrap CEO agents: universe
    /// scope plus every capability variant.
    #[must_use]
    pub fn ceo_preset() -> Self {
        Self {
            scope: AgentScope::default(),
            capabilities: vec![
                Capability::SpawnAgent,
                Capability::ControlAgent,
                Capability::ReadAgent,
                Capability::ManageOrgMembers,
                Capability::ManageBilling,
                Capability::InvokeProcess,
                Capability::PostToFeed,
                Capability::GenerateMedia,
            ],
        }
    }

    /// Empty permissions: universe scope (vacuously), zero capabilities.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// True iff `self` has universe scope and every capability variant
    /// from [`Self::ceo_preset`]. Used by the CEO bootstrap to decide
    /// whether an existing agent already plays the CEO role.
    #[must_use]
    pub fn is_ceo_preset(&self) -> bool {
        let ceo = Self::ceo_preset();
        if !self.scope.is_universe() {
            return false;
        }
        ceo.capabilities
            .iter()
            .all(|c| self.capabilities.contains(c))
    }

    /// Read-time safety net for CEO agents whose `permissions` bundle
    /// was persisted empty (older `aura-network` deployments didn't
    /// store the column, so legacy records round-trip as
    /// `AgentPermissions::empty()`).
    ///
    /// If `(name, role)` identifies the CEO role *and* `self` is not
    /// already the canonical [`Self::ceo_preset`], this returns the
    /// preset so downstream callers (tool manifest builders, sidekick
    /// toggles, etc.) see an agent with the capabilities users expect
    /// from the CEO icon. For every other case it returns `self`
    /// unchanged.
    ///
    /// The check is intentionally narrow — only `name == "CEO"` *and*
    /// `role == "CEO"` (case-insensitive) — so a non-CEO agent can't
    /// accidentally be promoted by sharing one field. A persistent
    /// write-time repair in the server's bootstrap handler will
    /// eventually patch the network record itself; this helper keeps
    /// the in-memory view correct between now and then.
    #[must_use]
    pub fn normalized_for_identity(self, name: &str, role: Option<&str>) -> Self {
        let looks_like_ceo = name.eq_ignore_ascii_case("CEO")
            && role.is_some_and(|r| r.eq_ignore_ascii_case("CEO"));
        if looks_like_ceo && !self.is_ceo_preset() {
            Self::ceo_preset()
        } else {
            self
        }
    }
}

// ---------------------------------------------------------------------------
// Wire conversions
// ---------------------------------------------------------------------------

impl From<Capability> for CapabilityWire {
    fn from(c: Capability) -> Self {
        match c {
            Capability::SpawnAgent => CapabilityWire::SpawnAgent,
            Capability::ControlAgent => CapabilityWire::ControlAgent,
            Capability::ReadAgent => CapabilityWire::ReadAgent,
            Capability::ManageOrgMembers => CapabilityWire::ManageOrgMembers,
            Capability::ManageBilling => CapabilityWire::ManageBilling,
            Capability::InvokeProcess => CapabilityWire::InvokeProcess,
            Capability::PostToFeed => CapabilityWire::PostToFeed,
            Capability::GenerateMedia => CapabilityWire::GenerateMedia,
            Capability::ReadProject { id } => CapabilityWire::ReadProject { id },
            Capability::WriteProject { id } => CapabilityWire::WriteProject { id },
        }
    }
}

impl From<CapabilityWire> for Capability {
    fn from(c: CapabilityWire) -> Self {
        match c {
            CapabilityWire::SpawnAgent => Capability::SpawnAgent,
            CapabilityWire::ControlAgent => Capability::ControlAgent,
            CapabilityWire::ReadAgent => Capability::ReadAgent,
            CapabilityWire::ManageOrgMembers => Capability::ManageOrgMembers,
            CapabilityWire::ManageBilling => Capability::ManageBilling,
            CapabilityWire::InvokeProcess => Capability::InvokeProcess,
            CapabilityWire::PostToFeed => Capability::PostToFeed,
            CapabilityWire::GenerateMedia => Capability::GenerateMedia,
            CapabilityWire::ReadProject { id } => Capability::ReadProject { id },
            CapabilityWire::WriteProject { id } => Capability::WriteProject { id },
        }
    }
}

impl From<AgentScope> for AgentScopeWire {
    fn from(s: AgentScope) -> Self {
        AgentScopeWire {
            orgs: s.orgs,
            projects: s.projects,
            agent_ids: s.agent_ids,
        }
    }
}

impl From<&AgentScope> for AgentScopeWire {
    fn from(s: &AgentScope) -> Self {
        AgentScopeWire {
            orgs: s.orgs.clone(),
            projects: s.projects.clone(),
            agent_ids: s.agent_ids.clone(),
        }
    }
}

impl From<AgentScopeWire> for AgentScope {
    fn from(s: AgentScopeWire) -> Self {
        AgentScope {
            orgs: s.orgs,
            projects: s.projects,
            agent_ids: s.agent_ids,
        }
    }
}

impl From<AgentPermissions> for AgentPermissionsWire {
    fn from(p: AgentPermissions) -> Self {
        AgentPermissionsWire {
            scope: p.scope.into(),
            capabilities: p.capabilities.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<&AgentPermissions> for AgentPermissionsWire {
    fn from(p: &AgentPermissions) -> Self {
        AgentPermissionsWire {
            scope: (&p.scope).into(),
            capabilities: p.capabilities.iter().cloned().map(Into::into).collect(),
        }
    }
}

impl From<AgentPermissionsWire> for AgentPermissions {
    fn from(p: AgentPermissionsWire) -> Self {
        AgentPermissions {
            scope: p.scope.into(),
            capabilities: p.capabilities.into_iter().map(Into::into).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceo_preset_is_universe_scope() {
        assert!(AgentPermissions::ceo_preset().scope.is_universe());
    }

    #[test]
    fn ceo_preset_round_trips_through_wire() {
        let perms = AgentPermissions::ceo_preset();
        let wire: AgentPermissionsWire = (&perms).into();
        let back: AgentPermissions = wire.into();
        assert_eq!(perms, back);
    }

    #[test]
    fn empty_perms_is_ceo_preset_false() {
        assert!(!AgentPermissions::empty().is_ceo_preset());
    }

    #[test]
    fn ceo_preset_recognised() {
        assert!(AgentPermissions::ceo_preset().is_ceo_preset());
    }

    #[test]
    fn normalized_for_identity_upgrades_empty_ceo_to_preset() {
        let upgraded =
            AgentPermissions::empty().normalized_for_identity("CEO", Some("CEO"));
        assert!(upgraded.is_ceo_preset());
    }

    #[test]
    fn normalized_for_identity_is_case_insensitive() {
        let upgraded =
            AgentPermissions::empty().normalized_for_identity("ceo", Some("Ceo"));
        assert!(upgraded.is_ceo_preset());
    }

    #[test]
    fn normalized_for_identity_leaves_non_ceo_untouched() {
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadAgent],
        };
        let same = perms.clone().normalized_for_identity("Atlas", Some("Engineer"));
        assert_eq!(same, perms);
    }

    #[test]
    fn normalized_for_identity_requires_both_name_and_role_to_match() {
        // name matches but role doesn't — must not promote.
        let only_name =
            AgentPermissions::empty().normalized_for_identity("CEO", Some("Engineer"));
        assert!(!only_name.is_ceo_preset());
        // role matches but name doesn't — must not promote.
        let only_role =
            AgentPermissions::empty().normalized_for_identity("Atlas", Some("CEO"));
        assert!(!only_role.is_ceo_preset());
        // role missing entirely — must not promote (prevents pre-
        // schema records from hijacking the preset).
        let missing_role = AgentPermissions::empty().normalized_for_identity("CEO", None);
        assert!(!missing_role.is_ceo_preset());
    }

    #[test]
    fn normalized_for_identity_preserves_already_correct_preset() {
        let preset = AgentPermissions::ceo_preset();
        let same = preset.clone().normalized_for_identity("CEO", Some("CEO"));
        assert_eq!(same, preset);
    }

    #[test]
    fn capability_serde_is_camel_case_external_tag() {
        let c = Capability::ReadProject {
            id: "p".into(),
        };
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["type"], "readProject");
        assert_eq!(v["id"], "p");
    }
}
