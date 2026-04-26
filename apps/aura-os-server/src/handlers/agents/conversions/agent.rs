use chrono::{DateTime, Utc};
use tracing::warn;

use aura_os_core::expertise;
use aura_os_core::listing_status::AgentListingStatus;
use aura_os_core::{Agent, AgentId, AgentPermissions, ProfileId};
use aura_os_network::NetworkAgent;
use aura_protocol::IntentClassifierSpec;

pub(crate) fn agent_from_network(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id_typed();
    let org_id: Option<aura_os_core::OrgId> = net.org_id.as_ref().and_then(|s| s.parse().ok());
    let (created_at, updated_at) = parse_agent_timestamps(net);
    let machine_type = net
        .machine_type
        .clone()
        .unwrap_or_else(|| "local".to_string());
    let environment = derive_environment(&machine_type);
    let tags: Vec<String> = net.tags.clone().unwrap_or_default();
    let listing_status = derive_listing_status(net, &tags);
    let expertise = derive_expertise(net, &tags);
    let (permissions, intent_classifier) = effective_permissions_and_classifier(net);

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        org_id,
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        machine_type,
        adapter_type: "aura_harness".to_string(),
        environment,
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        vm_id: net.vm_id.clone(),
        network_agent_id: net.id.parse().ok(),
        profile_id,
        tags,
        is_pinned: false,
        listing_status,
        expertise,
        jobs: net.jobs.unwrap_or(0),
        revenue_usd: net.revenue_usd.unwrap_or(0.0),
        reputation: net.reputation.unwrap_or(0.0),
        // Network-derived agents never carry a local override; populated later
        // from the local shadow if present.
        local_workspace_path: None,
        permissions,
        intent_classifier,
        created_at,
        updated_at,
    }
}

fn parse_agent_timestamps(net: &NetworkAgent) -> (DateTime<Utc>, DateTime<Utc>) {
    let epoch = DateTime::<Utc>::from(std::time::UNIX_EPOCH);
    let created_at = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(epoch);
    let updated_at = net
        .updated_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(created_at);
    (created_at, updated_at)
}

fn derive_environment(machine_type: &str) -> String {
    if machine_type == "remote" {
        "swarm_microvm".to_string()
    } else {
        "local_host".to_string()
    }
}

/// Marketplace listing_status: prefer the typed field; fall back to the
/// legacy `listing_status:<value>` tag so agents written before Phase 3
/// still render correctly. Unknown values default to Closed.
fn derive_listing_status(net: &NetworkAgent, tags: &[String]) -> AgentListingStatus {
    net.listing_status
        .as_deref()
        .and_then(|raw| raw.parse::<AgentListingStatus>().ok())
        .or_else(|| listing_status_from_tags(tags))
        .unwrap_or_default()
}

/// Marketplace expertise: prefer the typed field; fall back to the
/// `expertise:<slug>` tag encoding. Unknown slugs are filtered out so
/// stale client data cannot introduce invalid slugs on read.
fn derive_expertise(net: &NetworkAgent, tags: &[String]) -> Vec<String> {
    match net.expertise.as_ref() {
        Some(slugs) => slugs
            .iter()
            .filter(|slug| expertise::is_valid_slug(slug))
            .cloned()
            .collect(),
        None => expertise_from_tags(tags),
    }
}

/// Safety-net repair for CEO agents whose stored permissions bundle is
/// empty (or otherwise doesn't match the canonical CEO preset).
///
/// Older aura-network deployments didn't persist the `permissions` column
/// for agents, so `NetworkAgent.permissions` deserializes to the default
/// (empty) [`AgentPermissions`] via `#[serde(default)]`. When the rest of
/// the server reads that record, callers like [`build_cross_agent_tools`]
/// (the former in-process agent runtime) and the Permissions sidekick toggles key off
/// [`AgentPermissions::is_ceo_preset`] — so a CEO with an empty bundle
/// ends up with zero cross-agent tools installed and every capability
/// toggle rendered as "off", even though the agent is clearly the CEO.
///
/// The canonical "this is a CEO" signal is
/// [`AgentPermissions::is_ceo_preset`] on the stored bundle. When that
/// returns `false` but the agent's name and role both spell `CEO`, we
/// treat the stored bundle as corrupted-on-read and return the preset +
/// canonical intent classifier instead.
///
/// Permission normalisation is delegated to
/// [`AgentPermissions::normalized_for_identity`] so this handler and the
/// other read-time converter in `aura-os-agents::network_agent_to_core`
/// can't drift apart — both now route through the same `aura-os-core`
/// helper. The classifier fix-up stays here because it pulls the
/// canonical spec from the former in-process agent runtime, which sat above
/// `aura-os-agents` in the crate graph.
///
/// [`build_cross_agent_tools`]: crate::handlers::agents::workspace_tools
fn effective_permissions_and_classifier(
    net: &NetworkAgent,
) -> (AgentPermissions, Option<IntentClassifierSpec>) {
    let permissions = net
        .permissions
        .clone()
        .normalized_for_identity(&net.name, net.role.as_deref());
    let permissions_were_repaired = permissions != net.permissions;
    if permissions_were_repaired {
        warn!(
            agent_id = %net.id,
            "CEO agent has non-preset permissions in network record; applying read-time preset"
        );
        // CEO agents no longer ship an IntentClassifierSpec — the CEO
        // cross-agent tool list is a static allowlist (see
        // the old CEO core-tool allowlist). Preserve whatever
        // the network record carries (typically `None`) so legacy
        // deployments that still have a stored classifier don't have it
        // retroactively clobbered by the read-time repair path.
        return (permissions, net.intent_classifier.clone());
    }
    (permissions, net.intent_classifier.clone())
}

/// Parse `listing_status:<value>` from a tag list. Retained only as a
/// backward-compatibility fallback for agents that predate Phase 3.
fn listing_status_from_tags(tags: &[String]) -> Option<AgentListingStatus> {
    for tag in tags {
        if let Some(raw) = tag.strip_prefix(aura_os_core::listing_status::LISTING_STATUS_TAG_PREFIX)
        {
            if let Ok(parsed) = raw.parse::<AgentListingStatus>() {
                return Some(parsed);
            }
        }
    }
    None
}

/// Parse `expertise:<slug>` entries from a tag list, filtering out any
/// unknown slugs so the server never forwards invalid data to clients.
fn expertise_from_tags(tags: &[String]) -> Vec<String> {
    tags.iter()
        .filter_map(|tag| tag.strip_prefix(expertise::EXPERTISE_TAG_PREFIX))
        .filter(|slug| expertise::is_valid_slug(slug))
        .map(|slug| slug.to_string())
        .collect()
}
