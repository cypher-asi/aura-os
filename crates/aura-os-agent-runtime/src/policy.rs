//! Tool-call policy enforcement for the cross-agent dispatcher.
//!
//! The harness is expected to filter tools at session-init based on the
//! agent's capabilities, but the dispatcher MUST re-check on every call
//! so that a compromised or buggy harness cannot escalate beyond the
//! chatting agent's declared permissions.

use std::sync::Arc;
use std::time::{Duration, Instant};

use aura_os_core::{AgentPermissions, Capability};
use dashmap::DashMap;

/// Outcome of [`check_capabilities`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub reason: Option<String>,
}

impl PolicyDecision {
    #[must_use]
    pub fn allow() -> Self {
        Self {
            allowed: true,
            reason: None,
        }
    }

    #[must_use]
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            reason: Some(reason.into()),
        }
    }
}

/// Check that `agent_permissions` satisfies every entry in `required`.
///
/// Semantics:
/// * An empty `required` list always allows (ambient / unscoped tools).
/// * For each required capability, the agent must hold an overlapping
///   capability — see [`holds_capability`] for the matching rules. The
///   CEO preset no longer takes a separate fast path: it holds
///   [`Capability::ReadAllProjects`] + [`Capability::WriteAllProjects`]
///   wildcards which make it satisfy project-scoped requirements
///   through the normal path.
/// * Requirements compose with AND semantics: any single denial short-
///   circuits to a deny decision naming the offending capability.
#[must_use]
pub fn check_capabilities(
    agent_permissions: &AgentPermissions,
    required: &[Capability],
) -> PolicyDecision {
    if required.is_empty() {
        return PolicyDecision::allow();
    }

    for needed in required {
        if !holds_capability(agent_permissions, needed) {
            return PolicyDecision::deny(format!(
                "agent is missing required capability: {}",
                describe_capability(needed)
            ));
        }
    }

    PolicyDecision::allow()
}

/// Does `perms` hold a capability that satisfies `needed`?
///
/// * Unscoped variants match exactly on the bundle.
/// * `ReadProject { id }` is satisfied by (a) `ReadProject { id }` in
///   the bundle, (b) `WriteProject { id }` in the bundle (write implies
///   read), (c) [`Capability::ReadAllProjects`], or (d)
///   [`Capability::WriteAllProjects`] (wildcard write implies wildcard
///   read).
/// * `WriteProject { id }` is satisfied by (a) `WriteProject { id }`
///   in the bundle or (b) [`Capability::WriteAllProjects`].
/// * The two wildcard variants are exact-match only (no recursion).
#[must_use]
pub fn holds_capability(perms: &AgentPermissions, needed: &Capability) -> bool {
    match needed {
        Capability::ReadProject { id } => perms.capabilities.iter().any(|held| match held {
            Capability::ReadProject { id: held_id } => held_id == id,
            Capability::WriteProject { id: held_id } => held_id == id,
            Capability::ReadAllProjects | Capability::WriteAllProjects => true,
            _ => false,
        }),
        Capability::WriteProject { id } => perms.capabilities.iter().any(|held| match held {
            Capability::WriteProject { id: held_id } => held_id == id,
            Capability::WriteAllProjects => true,
            _ => false,
        }),
        other => perms.capabilities.contains(other),
    }
}

fn describe_capability(c: &Capability) -> String {
    match c {
        Capability::SpawnAgent => "spawnAgent".to_string(),
        Capability::ControlAgent => "controlAgent".to_string(),
        Capability::ReadAgent => "readAgent".to_string(),
        Capability::ManageOrgMembers => "manageOrgMembers".to_string(),
        Capability::ManageBilling => "manageBilling".to_string(),
        Capability::InvokeProcess => "invokeProcess".to_string(),
        Capability::PostToFeed => "postToFeed".to_string(),
        Capability::GenerateMedia => "generateMedia".to_string(),
        Capability::ReadProject { id } => format!("readProject({id})"),
        Capability::WriteProject { id } => format!("writeProject({id})"),
        Capability::ReadAllProjects => "readAllProjects".to_string(),
        Capability::WriteAllProjects => "writeAllProjects".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Permissions cache
// ---------------------------------------------------------------------------
//
// The cross-agent tool dispatcher needs to look up the calling agent's
// `AgentPermissions` on every tool call. Before this cache the dispatcher
// tried a local-shadow lookup followed by an aura-network round-trip,
// which (a) adds a hop per tool call and (b) fails outright on local-only
// installs where `get_agent_with_jwt` returns `"aura-network is not
// configured"` — producing a 403 on every cross-agent call.
//
// We avoid both problems by populating the cache at session-open (where
// the full Agent / AgentInstance record is already in memory). The
// dispatcher can then answer capability checks from this cache without
// ever touching aura-network. Entries expire after 10 minutes to bound
// staleness if the agent's permissions are edited in aura-network
// mid-session — the next tool call after the TTL triggers a normal
// resolve + re-cache.
//
// The cache is keyed by stamped-id string because `chat.rs` stamps both
// `AgentId` (org-level chat) and `AgentInstanceId` (project-instance
// chat) as `X-Aura-Agent-Id`, and the dispatcher reads the raw header
// value. Parsing as `AgentId` would exclude the instance case entirely,
// which was one of the original 403 sources.

/// Cache entry. Expires 10 min after insertion to bound staleness if
/// the agent's permissions are edited in aura-network mid-session.
#[derive(Clone)]
pub struct CachedPermissions {
    pub permissions: AgentPermissions,
    inserted_at: Instant,
}

/// In-memory map from stamped id (agent_id or agent_instance_id, as a
/// string) to the permissions bundle we resolved at session-open.
/// Keyed by string (not `AgentId`) because chat.rs stamps both flavors
/// of UUID and the dispatcher reads the raw header value.
#[derive(Clone, Default)]
pub struct PermissionsCache {
    inner: Arc<DashMap<String, CachedPermissions>>,
}

impl PermissionsCache {
    /// Time-to-live for every cache entry. Hard-coded so the cache
    /// behaves identically in prod and in tests; deliberately not
    /// plumbed as a config knob.
    pub const TTL: Duration = Duration::from_secs(600);

    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert or overwrite the entry for `stamped_id`. The caller
    /// should pass the permissions bundle *after*
    /// [`AgentPermissions::normalized_for_identity`] so dispatcher
    /// lookups see the same CEO promotion as session-open.
    pub fn insert(&self, stamped_id: impl Into<String>, permissions: AgentPermissions) {
        self.inner.insert(
            stamped_id.into(),
            CachedPermissions {
                permissions,
                inserted_at: Instant::now(),
            },
        );
    }

    /// Fetch a non-expired entry. Expired entries are evicted in place
    /// so callers can treat `None` as "not cached" without a separate
    /// sweep pass.
    pub fn get(&self, stamped_id: &str) -> Option<AgentPermissions> {
        let expired = {
            let entry = self.inner.get(stamped_id)?;
            if entry.inserted_at.elapsed() > Self::TTL {
                true
            } else {
                return Some(entry.permissions.clone());
            }
        };
        if expired {
            self.inner.remove(stamped_id);
        }
        None
    }

    pub fn remove(&self, stamped_id: &str) {
        self.inner.remove(stamped_id);
    }

    /// Diagnostic: count of live (non-expired) entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Test-only hook to backdate an entry's `inserted_at` so expiry
    /// tests don't need `std::thread::sleep`. Returns `true` if the
    /// entry existed and was updated.
    #[cfg(test)]
    fn set_inserted_at_for_test(&self, stamped_id: &str, inserted_at: Instant) -> bool {
        if let Some(mut entry) = self.inner.get_mut(stamped_id) {
            entry.inserted_at = inserted_at;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentPermissions, AgentScope, Capability};

    fn with_caps(caps: Vec<Capability>) -> AgentPermissions {
        AgentPermissions {
            scope: AgentScope::default(),
            capabilities: caps,
        }
    }

    #[test]
    fn empty_required_always_allows() {
        let perms = AgentPermissions::empty();
        assert!(check_capabilities(&perms, &[]).allowed);
    }

    #[test]
    fn ceo_preset_allows_everything() {
        let perms = AgentPermissions::ceo_preset();
        assert!(check_capabilities(&perms, &[Capability::SpawnAgent]).allowed);
        assert!(check_capabilities(&perms, &[Capability::ManageBilling]).allowed);
        assert!(
            check_capabilities(
                &perms,
                &[Capability::ReadProject {
                    id: "proj-1".into()
                }],
            )
            .allowed
        );
        assert!(
            check_capabilities(
                &perms,
                &[Capability::WriteProject {
                    id: "proj-1".into()
                }],
            )
            .allowed
        );
    }

    #[test]
    fn empty_permissions_denies_any_required_capability() {
        let perms = AgentPermissions::empty();
        let d = check_capabilities(&perms, &[Capability::SpawnAgent]);
        assert!(!d.allowed);
        assert!(d.reason.is_some());
    }

    #[test]
    fn exact_capability_match_allows() {
        let perms = with_caps(vec![Capability::ReadAgent]);
        assert!(check_capabilities(&perms, &[Capability::ReadAgent]).allowed);
    }

    #[test]
    fn exact_capability_mismatch_denies() {
        let perms = with_caps(vec![Capability::ReadAgent]);
        let d = check_capabilities(&perms, &[Capability::SpawnAgent]);
        assert!(!d.allowed);
        assert!(d.reason.unwrap().contains("spawnAgent"));
    }

    #[test]
    fn read_project_requires_matching_id() {
        let perms = with_caps(vec![Capability::ReadProject {
            id: "proj-1".into(),
        }]);
        assert!(
            check_capabilities(
                &perms,
                &[Capability::ReadProject {
                    id: "proj-1".into()
                }],
            )
            .allowed
        );
        assert!(
            !check_capabilities(
                &perms,
                &[Capability::ReadProject {
                    id: "proj-other".into()
                }],
            )
            .allowed
        );
    }

    #[test]
    fn write_project_implies_read_project() {
        let perms = with_caps(vec![Capability::WriteProject {
            id: "proj-1".into(),
        }]);
        assert!(
            check_capabilities(
                &perms,
                &[Capability::ReadProject {
                    id: "proj-1".into()
                }],
            )
            .allowed
        );
    }

    #[test]
    fn read_project_does_not_imply_write_project() {
        let perms = with_caps(vec![Capability::ReadProject {
            id: "proj-1".into(),
        }]);
        assert!(
            !check_capabilities(
                &perms,
                &[Capability::WriteProject {
                    id: "proj-1".into()
                }],
            )
            .allowed
        );
    }

    #[test]
    fn multiple_required_caps_all_must_hold() {
        let perms = with_caps(vec![Capability::ReadAgent, Capability::ControlAgent]);
        // AND: all held → allow
        assert!(
            check_capabilities(&perms, &[Capability::ReadAgent, Capability::ControlAgent]).allowed
        );
        // AND: one missing → deny
        let d = check_capabilities(&perms, &[Capability::ReadAgent, Capability::SpawnAgent]);
        assert!(!d.allowed);
        assert!(d.reason.unwrap().contains("spawnAgent"));
    }

    // -----------------------------------------------------------------
    // PermissionsCache
    // -----------------------------------------------------------------

    #[test]
    fn permissions_cache_insert_then_get_returns_bundle() {
        let cache = PermissionsCache::new();
        let perms = AgentPermissions::ceo_preset();
        cache.insert("agent-007", perms.clone());

        let got = cache
            .get("agent-007")
            .expect("cached entry must be present");
        assert_eq!(got, perms);
        assert_eq!(cache.len(), 1);
        assert!(!cache.is_empty());
    }

    #[test]
    fn permissions_cache_get_missing_returns_none() {
        let cache = PermissionsCache::new();
        assert!(cache.get("nope").is_none());
        assert!(cache.is_empty());
    }

    #[test]
    fn permissions_cache_expiry_evicts_stale_entry() {
        let cache = PermissionsCache::new();
        cache.insert("stale", AgentPermissions::ceo_preset());

        // Backdate the insertion time to just past the TTL so the next
        // `get` sees an expired entry and evicts it.
        let backdated = Instant::now() - PermissionsCache::TTL - Duration::from_secs(1);
        assert!(cache.set_inserted_at_for_test("stale", backdated));

        assert!(cache.get("stale").is_none());
        assert!(cache.is_empty(), "expired entry must be evicted on get");
    }

    #[test]
    fn permissions_cache_remove_evicts_entry() {
        let cache = PermissionsCache::new();
        cache.insert("a", AgentPermissions::ceo_preset());
        cache.insert("b", AgentPermissions::empty());
        assert_eq!(cache.len(), 2);

        cache.remove("a");
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_some());
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn permissions_cache_insert_overwrites_existing_entry() {
        let cache = PermissionsCache::new();
        cache.insert("agent-007", AgentPermissions::empty());
        cache.insert("agent-007", AgentPermissions::ceo_preset());

        let got = cache.get("agent-007").expect("entry must be present");
        assert!(got.is_ceo_preset());
        assert_eq!(cache.len(), 1, "overwrite must not create a second entry");
    }
}
