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
//!
//! TODO(Phase 7): collapse this native mirror into protocol/domain DTOs
//! once agent records no longer persist `AgentPermissions` directly.

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
    ListAgents,
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
    /// Wildcard read access over every project. Satisfies any
    /// `ReadProject { id }` requirement without enumerating ids.
    /// Held by the CEO preset so the unified tool-surface filter
    /// can drop the legacy `is_ceo_preset()` short-circuit.
    ReadAllProjects,
    /// Wildcard write access over every project; strict superset of
    /// [`Capability::ReadAllProjects`]. Satisfies any
    /// `WriteProject { id }` requirement and (by write-implies-read)
    /// any `ReadProject { id }` requirement.
    WriteAllProjects,
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
    /// Fully permissive agent bundle: universe scope plus every capability
    /// variant that does not require a host-specific id.
    #[must_use]
    pub fn full_access() -> Self {
        Self {
            scope: AgentScope::default(),
            capabilities: vec![
                Capability::SpawnAgent,
                Capability::ControlAgent,
                Capability::ReadAgent,
                Capability::ListAgents,
                Capability::ManageOrgMembers,
                Capability::ManageBilling,
                Capability::InvokeProcess,
                Capability::PostToFeed,
                Capability::GenerateMedia,
                // Wildcard project caps replace the legacy
                // `is_ceo_preset()` short-circuit in `policy::check_capabilities`
                // and the tool-surface filter: the CEO now satisfies
                // `ReadProject { id }` / `WriteProject { id }` through
                // the normal `holds_capability` path like any other
                // bundle that happens to carry a wildcard.
                Capability::ReadAllProjects,
                Capability::WriteAllProjects,
            ],
        }
    }

    /// Historical name for the bootstrap CEO bundle. Kept as an alias so
    /// existing CEO-specific checks keep compiling while default agent access
    /// is expressed through [`Self::full_access`].
    #[must_use]
    pub fn ceo_preset() -> Self {
        Self::full_access()
    }

    /// Empty permissions: universe scope (vacuously), zero capabilities.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// True iff this bundle carries **no** capabilities and **no**
    /// scope restrictions — the same shape produced by
    /// [`Self::empty`] / [`Self::default`].
    ///
    /// Used as the read-time reconciliation trigger when an
    /// `aura-network` GET response round-trips through
    /// [`network_agent_to_core`] with a missing/dropped `permissions`
    /// column: if the freshly-fetched bundle is empty *and* the local
    /// shadow has a non-empty bundle, we prefer the shadow. This
    /// mirrors the PUT-side defensive reconciliation in
    /// `handlers::agents::crud::update_agent`, which already trusts
    /// the caller's submitted bundle when the PUT response fails to
    /// echo it back. Without a symmetric read-side rule, every
    /// `GET /agents` / `GET /agents/:id` clobbered the shadow with
    /// the empty default on app boot, which is exactly the "toggles
    /// survive in the session but vanish after restart" symptom.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.capabilities.is_empty() && self.scope.is_universe()
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

    /// Read-time safety net for records whose `permissions` bundle was
    /// persisted empty (older `aura-network` deployments didn't store the
    /// column, so legacy records round-trip as `AgentPermissions::empty()`).
    ///
    /// Empty/default bundles are treated as the product default,
    /// [`Self::full_access`]. If `(name, role)` identifies the CEO role and
    /// `self` is not already canonical, this also returns the full-access
    /// preset so downstream callers (tool manifest builders, sidekick toggles,
    /// etc.) see the expected capability set.
    ///
    /// The check is intentionally narrow — only `name == "CEO"` *and*
    /// `role == "CEO"` (case-insensitive) — so a non-CEO agent can't
    /// accidentally be promoted by sharing one field. A persistent
    /// write-time repair in the server's bootstrap handler will
    /// eventually patch the network record itself; this helper keeps
    /// the in-memory view correct between now and then.
    #[must_use]
    pub fn normalized_for_identity(self, name: &str, role: Option<&str>) -> Self {
        let looks_like_ceo =
            name.eq_ignore_ascii_case("CEO") && role.is_some_and(|r| r.eq_ignore_ascii_case("CEO"));
        if looks_like_ceo && !self.is_ceo_preset() {
            Self::ceo_preset()
        } else if self.is_empty() {
            Self::full_access()
        } else {
            self
        }
    }

    /// Splice `ReadProject { id: project_id }` and
    /// `WriteProject { id: project_id }` into this bundle *iff* it
    /// doesn't already satisfy the corresponding
    /// `CapabilityRequirement::ReadProjectFromArg` /
    /// `WriteProjectFromArg` gate for `project_id` (via an exact grant
    /// or a `ReadAllProjects` / `WriteAllProjects` wildcard).
    ///
    /// # Why
    ///
    /// Harness-side domain tools require at least *some* project grant
    /// for project-scoped operations (`get_project`, `list_specs`,
    /// `create_spec`, `create_task`, `run_task`, …). When a non-CEO
    /// agent is persisted with an empty `capabilities` list (common for
    /// fresh agents whose permissions column was never populated), the
    /// harness denies those calls because its kernel policy defaults to
    /// `allow_unlisted = false`.
    ///
    /// Calling this helper at chat-open time — when we already know
    /// the agent is bound to `project_id` and the session's JWT will
    /// re-verify project membership on every downstream aura-storage /
    /// aura-network call — closes that gap without weakening the
    /// capability gate: the splice only grants self-project access,
    /// not arbitrary ids.
    #[must_use]
    pub fn with_project_self_caps(mut self, project_id: &str) -> Self {
        let has_read = self.capabilities.iter().any(|c| match c {
            Capability::ReadProject { id } | Capability::WriteProject { id } => id == project_id,
            Capability::ReadAllProjects | Capability::WriteAllProjects => true,
            _ => false,
        });
        let has_write = self.capabilities.iter().any(|c| match c {
            Capability::WriteProject { id } => id == project_id,
            Capability::WriteAllProjects => true,
            _ => false,
        });
        if !has_read {
            self.capabilities.push(Capability::ReadProject {
                id: project_id.to_string(),
            });
        }
        if !has_write {
            self.capabilities.push(Capability::WriteProject {
                id: project_id.to_string(),
            });
        }
        self
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
            Capability::ListAgents => CapabilityWire::ListAgents,
            Capability::ManageOrgMembers => CapabilityWire::ManageOrgMembers,
            Capability::ManageBilling => CapabilityWire::ManageBilling,
            Capability::InvokeProcess => CapabilityWire::InvokeProcess,
            Capability::PostToFeed => CapabilityWire::PostToFeed,
            Capability::GenerateMedia => CapabilityWire::GenerateMedia,
            Capability::ReadProject { id } => CapabilityWire::ReadProject { id },
            Capability::WriteProject { id } => CapabilityWire::WriteProject { id },
            Capability::ReadAllProjects => CapabilityWire::ReadAllProjects,
            Capability::WriteAllProjects => CapabilityWire::WriteAllProjects,
        }
    }
}

/// Error produced when a [`CapabilityWire::Unknown`] forward-compat
/// placeholder is converted to the native [`Capability`] enum, which
/// cannot represent unknown variants. Callers that receive wire
/// bundles should treat this as "drop this capability" rather than
/// propagate the error (see the `From<AgentPermissionsWire>` impl).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownCapability;

impl std::fmt::Display for UnknownCapability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("unknown capability variant")
    }
}

impl std::error::Error for UnknownCapability {}

impl TryFrom<CapabilityWire> for Capability {
    type Error = UnknownCapability;

    fn try_from(c: CapabilityWire) -> Result<Self, Self::Error> {
        Ok(match c {
            CapabilityWire::SpawnAgent => Capability::SpawnAgent,
            CapabilityWire::ControlAgent => Capability::ControlAgent,
            CapabilityWire::ReadAgent => Capability::ReadAgent,
            CapabilityWire::ListAgents => Capability::ListAgents,
            CapabilityWire::ManageOrgMembers => Capability::ManageOrgMembers,
            CapabilityWire::ManageBilling => Capability::ManageBilling,
            CapabilityWire::InvokeProcess => Capability::InvokeProcess,
            CapabilityWire::PostToFeed => Capability::PostToFeed,
            CapabilityWire::GenerateMedia => Capability::GenerateMedia,
            CapabilityWire::ReadProject { id } => Capability::ReadProject { id },
            CapabilityWire::WriteProject { id } => Capability::WriteProject { id },
            CapabilityWire::ReadAllProjects => Capability::ReadAllProjects,
            CapabilityWire::WriteAllProjects => Capability::WriteAllProjects,
            CapabilityWire::Unknown => return Err(UnknownCapability),
        })
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
        // Drop `CapabilityWire::Unknown` placeholders: they indicate the
        // wire bundle carried a variant introduced after this build's
        // protocol version. The native `Capability` enum cannot
        // represent them, and policy checks over an unknown token are
        // never satisfiable. Preserving the enclosing session with a
        // narrower capability set is strictly safer than rejecting it.
        AgentPermissions {
            scope: p.scope.into(),
            capabilities: p
                .capabilities
                .into_iter()
                .filter_map(|c| Capability::try_from(c).ok())
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests;
