//! Marketplace agent listing handlers.
//!
//! Phase 3 reads marketplace state from typed fields on
//! [`aura_os_core::Agent`] (`listing_status`, `expertise`, `jobs`,
//! `revenue_usd`, `reputation`) rather than `Agent.tags`. When
//! `state.network_client` is configured we prefer the network list so
//! remote agents surface as soon as they flip to `hireable` elsewhere.
//!
//! Sort / expertise / pagination semantics mirror
//! `applyMarketplaceFilters` in
//! `interface/src/apps/marketplace/stores/marketplace-store.ts`.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, Query, State};
use axum::Json;
use futures_util::future::join_all;
use tracing::{info, warn};

use aura_os_core::listing_status::AgentListingStatus;
use aura_os_core::{Agent, AgentId};
use aura_os_network::{ListMarketplaceAgentsParams, NetworkClient, NetworkProfile};

use crate::dto::{ListMarketplaceAgentsQuery, ListMarketplaceAgentsResponse, MarketplaceAgent};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions_pub::agent_from_network;
use crate::state::{AppState, AuthJwt};

const DEFAULT_PAGE_LIMIT: u32 = 50;
const MAX_PAGE_LIMIT: u32 = 100;

pub(crate) async fn list_marketplace_agents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<ListMarketplaceAgentsQuery>,
) -> ApiResult<Json<ListMarketplaceAgentsResponse>> {
    let sort = parse_sort(query.sort.as_deref())?;
    let expertise = query.expertise.as_deref().filter(|s| !s.is_empty());
    let limit = query
        .limit
        .unwrap_or(DEFAULT_PAGE_LIMIT)
        .clamp(1, MAX_PAGE_LIMIT);
    let offset = query.offset.unwrap_or(0);

    // Forward the parsed params to the network so it can return the
    // public marketplace view (cross-user) instead of the caller's own
    // roster. We still re-apply expertise/sort/pagination locally below
    // so `total` and ordering remain authoritative on this server.
    let net_params = ListMarketplaceAgentsParams {
        sort: Some(sort_to_str(sort)),
        expertise,
        limit: Some(limit),
        offset: Some(offset),
    };

    let source_agents = load_hireable_agents(&state, &jwt, &net_params).await?;
    let client = state.network_client.as_deref();
    let profiles = resolve_creator_profiles(client, &jwt, &source_agents).await;

    let mut entries: Vec<MarketplaceAgent> = source_agents
        .into_iter()
        .map(|agent| build_marketplace_agent(agent, &profiles))
        .collect();

    if let Some(slug) = expertise {
        entries.retain(|entry| entry.agent.expertise.iter().any(|s| s == slug));
    }

    sort_entries(&mut entries, sort);

    let total = entries.len() as u64;
    let page: Vec<MarketplaceAgent> = entries
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();

    Ok(Json(ListMarketplaceAgentsResponse {
        agents: page,
        total,
    }))
}

pub(crate) async fn get_marketplace_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<MarketplaceAgent>> {
    let agent = load_agent(&state, &jwt, &agent_id).await?;
    if !agent_is_hireable(&agent) {
        return Err(ApiError::not_found(format!(
            "agent `{agent_id}` is not listed on the marketplace"
        )));
    }
    let client = state.network_client.as_deref();
    let profiles = resolve_creator_profiles(client, &jwt, std::slice::from_ref(&agent)).await;
    Ok(Json(build_marketplace_agent(agent, &profiles)))
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/// Load the union of hireable agents from every source we know about.
///
/// We can't rely on the cross-user `client.list_marketplace_agents` view
/// alone: aura-network may not yet expose other users' hireable agents to
/// the caller, and several upstream deployments scope `GET /api/agents`
/// (with or without `listing_status` filters) to the calling user. To make
/// "I marked my agent hireable" actually surface in the marketplace UI,
/// we union three sources by `agent_id`:
///
/// 1. `client.list_marketplace_agents` — the public marketplace view.
///    Highest priority on duplicates because its aggregated stats
///    (`jobs`, `revenue_usd`, …) are server-computed.
/// 2. `client.list_agents` — the caller-scoped network roster, filtered
///    locally to `Hireable`. This catches the user's own listings even
///    when the marketplace view excludes them.
/// 3. `state.agent_service.list_agents` — local shadows, filtered to
///    `Hireable`. This catches listings whose `listing_status` flip is
///    persisted locally but hasn't yet round-tripped from the network
///    response.
///
/// Errors from sources 2 and 3 are logged and swallowed — they're
/// best-effort fallbacks. Only source 1's failure surfaces as an
/// `ApiError`, since that's the canonical marketplace endpoint.
async fn load_hireable_agents(
    state: &AppState,
    jwt: &str,
    net_params: &ListMarketplaceAgentsParams<'_>,
) -> ApiResult<Vec<Agent>> {
    // Source 3 (lowest priority): local shadows.
    let local: Vec<Agent> = match state.agent_service.list_agents() {
        Ok(locals) => locals.into_iter().filter(agent_is_hireable).collect(),
        Err(err) => {
            warn!(%err, "marketplace: listing local agents failed");
            Vec::new()
        }
    };

    // Source 2: caller-scoped network roster (network mode only).
    let owned: Vec<Agent> = if let Some(client) = state.network_client.as_ref() {
        match client.list_agents(jwt).await {
            Ok(net_agents) => net_agents
                .iter()
                .map(|na| {
                    let mut agent = agent_from_network(na);
                    let _ = state.agent_service.apply_runtime_config(&mut agent);
                    agent
                })
                .filter(agent_is_hireable)
                .collect(),
            Err(err) => {
                warn!(%err, "marketplace: caller-scoped list_agents failed");
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    // Source 1 (highest priority): cross-user marketplace view. When a
    // network client is configured this is the canonical endpoint; if it
    // fails we propagate the error rather than silently falling back to
    // only the caller's own agents.
    let market: Vec<Agent> = if let Some(client) = state.network_client.as_ref() {
        let net_agents = client
            .list_marketplace_agents(jwt, net_params)
            .await
            .map_err(map_network_error)?;
        net_agents
            .iter()
            .map(|na| {
                let mut agent = agent_from_network(na);
                let _ = state.agent_service.apply_runtime_config(&mut agent);
                agent
            })
            .filter(agent_is_hireable)
            .collect()
    } else {
        Vec::new()
    };

    let local_count = local.len();
    let owned_count = owned.len();
    let market_count = market.len();
    let result = union_hireable_by_id(local, owned, market);
    info!(
        marketplace = market_count,
        owned = owned_count,
        local = local_count,
        total = result.len(),
        "marketplace load_hireable_agents counts"
    );
    Ok(result)
}

/// Union the three hireable-agent sources by `agent_id`, with marketplace
/// rows winning over caller-scoped rows winning over local shadows. Pure
/// function so it can be unit-tested without standing up an `AppState`.
fn union_hireable_by_id(
    local: Vec<Agent>,
    owned: Vec<Agent>,
    market: Vec<Agent>,
) -> Vec<Agent> {
    let mut by_id: HashMap<AgentId, Agent> = HashMap::new();
    for agent in local.into_iter().chain(owned).chain(market) {
        // Insert order is local -> owned -> market, so the latest insert
        // wins on duplicates and gives marketplace the highest priority.
        by_id.insert(agent.agent_id, agent);
    }
    by_id.into_values().collect()
}

async fn load_agent(state: &AppState, jwt: &str, agent_id: &AgentId) -> ApiResult<Agent> {
    if let Some(client) = state.network_client.as_ref() {
        let net_agent = client
            .get_agent(&agent_id.to_string(), jwt)
            .await
            .map_err(map_network_error)?;
        let mut agent = agent_from_network(&net_agent);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        return Ok(agent);
    }
    state
        .agent_service
        .get_agent_local(agent_id)
        .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))
}

fn agent_is_hireable(agent: &Agent) -> bool {
    matches!(agent.listing_status, AgentListingStatus::Hireable)
}

// ---------------------------------------------------------------------------
// Creator display names
// ---------------------------------------------------------------------------

async fn resolve_creator_profiles(
    client: Option<&NetworkClient>,
    jwt: &str,
    agents: &[Agent],
) -> HashMap<String, NetworkProfile> {
    let Some(client) = client else {
        return HashMap::new();
    };

    let mut seen: HashSet<String> = HashSet::new();
    let mut targets: Vec<String> = Vec::new();
    for agent in agents {
        if !agent.user_id.is_empty() && seen.insert(agent.user_id.clone()) {
            targets.push(agent.user_id.clone());
        }
    }
    if targets.is_empty() {
        return HashMap::new();
    }

    let futs = targets.into_iter().map(|id| {
        let client = client.clone();
        let jwt = jwt.to_owned();
        async move {
            if let Ok(p) = client.get_user_profile(&id, &jwt).await {
                return (id, Some(p));
            }
            if let Ok(p) = client.get_profile(&id, &jwt).await {
                return (id, Some(p));
            }
            if let Ok(user) = client.get_user(&id, &jwt).await {
                return (
                    id.clone(),
                    Some(NetworkProfile {
                        id: user.profile_id.unwrap_or_else(|| id.clone()),
                        display_name: user.display_name,
                        avatar_url: user.avatar_url,
                        bio: user.bio,
                        profile_type: Some("user".into()),
                        entity_id: None,
                        user_id: Some(id.clone()),
                        agent_id: None,
                    }),
                );
            }
            warn!(user_id = %id, "could not resolve marketplace creator profile");
            (id, None)
        }
    });

    join_all(futs)
        .await
        .into_iter()
        .filter_map(|(id, profile)| profile.map(|p| (id, p)))
        .collect()
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

fn build_marketplace_agent(
    agent: Agent,
    profiles: &HashMap<String, NetworkProfile>,
) -> MarketplaceAgent {
    let creator_user_id = agent.user_id.clone();
    let creator_display_name = profiles
        .get(&creator_user_id)
        .and_then(|p| p.display_name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| creator_user_id.clone());
    let listed_at = agent.created_at.to_rfc3339();
    let description = agent.role.clone();
    let jobs = agent.jobs;
    let revenue_usd = agent.revenue_usd;
    let reputation = agent.reputation;

    MarketplaceAgent {
        agent,
        description,
        jobs,
        revenue_usd,
        reputation,
        creator_display_name,
        creator_user_id,
        cover_image_url: None,
        listed_at,
    }
}

// ---------------------------------------------------------------------------
// Filtering / sorting
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarketplaceSort {
    Trending,
    Latest,
    Revenue,
    Reputation,
}

fn parse_sort(raw: Option<&str>) -> ApiResult<MarketplaceSort> {
    match raw.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        None | Some("trending") => Ok(MarketplaceSort::Trending),
        Some("latest") => Ok(MarketplaceSort::Latest),
        Some("revenue") => Ok(MarketplaceSort::Revenue),
        Some("reputation") => Ok(MarketplaceSort::Reputation),
        Some(other) => Err(ApiError::bad_request(format!(
            "unsupported marketplace sort `{other}`"
        ))),
    }
}

fn sort_to_str(sort: MarketplaceSort) -> &'static str {
    match sort {
        MarketplaceSort::Trending => "trending",
        MarketplaceSort::Latest => "latest",
        MarketplaceSort::Revenue => "revenue",
        MarketplaceSort::Reputation => "reputation",
    }
}

fn sort_entries(entries: &mut [MarketplaceAgent], sort: MarketplaceSort) {
    match sort {
        MarketplaceSort::Trending => {
            entries.sort_by(|a, b| b.jobs.cmp(&a.jobs));
        }
        MarketplaceSort::Latest => {
            entries.sort_by(|a, b| b.listed_at.cmp(&a.listed_at));
        }
        MarketplaceSort::Revenue => {
            entries.sort_by(|a, b| {
                b.revenue_usd
                    .partial_cmp(&a.revenue_usd)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        MarketplaceSort::Reputation => {
            entries.sort_by(|a, b| {
                b.reputation
                    .partial_cmp(&a.reputation)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::AgentId;
    use chrono::{TimeZone, Utc};

    fn sample_agent(
        id: &str,
        listing_status: AgentListingStatus,
        expertise: Vec<&str>,
        time_offset_seconds: i64,
    ) -> Agent {
        let created = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap()
            + chrono::Duration::seconds(time_offset_seconds);
        Agent {
            agent_id: AgentId::new(),
            user_id: format!("user-{id}"),
            org_id: None,
            name: id.to_string(),
            role: format!("role-{id}"),
            personality: String::new(),
            system_prompt: String::new(),
            skills: vec![],
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: "local_host".into(),
            auth_source: "aura_credit".into(),
            integration_id: None,
            default_model: None,
            vm_id: None,
            network_agent_id: None,
            profile_id: None,
            tags: Vec::new(),
            is_pinned: false,
            listing_status,
            expertise: expertise.into_iter().map(String::from).collect(),
            jobs: 0,
            revenue_usd: 0.0,
            reputation: 0.0,
            local_workspace_path: None,
            permissions: aura_os_core::AgentPermissions::full_access(),
            intent_classifier: None,
            created_at: created,
            updated_at: created,
        }
    }

    fn sample_agent_with_stats(
        id: &str,
        listing_status: AgentListingStatus,
        expertise: Vec<&str>,
        jobs: u64,
        revenue_usd: f64,
        reputation: f32,
        time_offset_seconds: i64,
    ) -> Agent {
        let mut agent = sample_agent(id, listing_status, expertise, time_offset_seconds);
        agent.jobs = jobs;
        agent.revenue_usd = revenue_usd;
        agent.reputation = reputation;
        agent
    }

    #[test]
    fn hireable_filter_uses_typed_listing_status() {
        let hireable = sample_agent("a", AgentListingStatus::Hireable, vec![], 0);
        let closed = sample_agent("b", AgentListingStatus::Closed, vec![], 0);
        assert!(agent_is_hireable(&hireable));
        assert!(!agent_is_hireable(&closed));
    }

    #[test]
    fn parse_sort_accepts_known_values_and_rejects_unknown() {
        assert_eq!(parse_sort(None).unwrap(), MarketplaceSort::Trending);
        assert_eq!(parse_sort(Some("")).unwrap(), MarketplaceSort::Trending);
        assert_eq!(parse_sort(Some("latest")).unwrap(), MarketplaceSort::Latest);
        assert_eq!(
            parse_sort(Some("reputation")).unwrap(),
            MarketplaceSort::Reputation
        );
        let err = parse_sort(Some("bogus")).expect_err("should reject");
        assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn sort_latest_orders_by_listed_at_desc() {
        let profiles = HashMap::new();
        let mut entries = vec![
            build_marketplace_agent(
                sample_agent("older", AgentListingStatus::Hireable, vec![], 10),
                &profiles,
            ),
            build_marketplace_agent(
                sample_agent("newer", AgentListingStatus::Hireable, vec![], 100),
                &profiles,
            ),
        ];
        sort_entries(&mut entries, MarketplaceSort::Latest);
        assert_eq!(entries[0].agent.name, "newer");
        assert_eq!(entries[1].agent.name, "older");
    }

    #[test]
    fn build_marketplace_agent_uses_role_as_description_and_creator_fallback() {
        let profiles = HashMap::new();
        let entry = build_marketplace_agent(
            sample_agent("x", AgentListingStatus::Hireable, vec![], 0),
            &profiles,
        );
        assert_eq!(entry.description, "role-x");
        assert_eq!(entry.creator_user_id, "user-x");
        // When no profile is available, fall back to the raw user_id so the
        // UI still has *something* to render.
        assert_eq!(entry.creator_display_name, "user-x");
        assert_eq!(entry.jobs, 0);
    }

    #[test]
    fn build_marketplace_agent_copies_typed_stats_from_agent() {
        let profiles = HashMap::new();
        let agent = sample_agent_with_stats(
            "star",
            AgentListingStatus::Hireable,
            vec!["coding"],
            42,
            9_876.54,
            4.75,
            0,
        );
        let entry = build_marketplace_agent(agent, &profiles);
        assert_eq!(entry.jobs, 42);
        assert!((entry.revenue_usd - 9_876.54).abs() < f64::EPSILON);
        assert!((entry.reputation - 4.75).abs() < f32::EPSILON);
    }

    #[test]
    fn sort_trending_orders_by_jobs_desc() {
        let profiles = HashMap::new();
        let mut entries = vec![
            build_marketplace_agent(
                sample_agent_with_stats(
                    "low",
                    AgentListingStatus::Hireable,
                    vec![],
                    1,
                    0.0,
                    0.0,
                    0,
                ),
                &profiles,
            ),
            build_marketplace_agent(
                sample_agent_with_stats(
                    "high",
                    AgentListingStatus::Hireable,
                    vec![],
                    100,
                    0.0,
                    0.0,
                    0,
                ),
                &profiles,
            ),
        ];
        sort_entries(&mut entries, MarketplaceSort::Trending);
        assert_eq!(entries[0].agent.name, "high");
        assert_eq!(entries[1].agent.name, "low");
    }

    #[test]
    fn union_keeps_marketplace_row_over_owned_and_local_for_same_id() {
        // The marketplace endpoint's stats are server-computed and freshest,
        // so when the same agent appears in multiple sources the marketplace
        // row must win. We assert this by giving the same `agent_id` three
        // different `jobs` counts and checking the marketplace one survives.
        let shared_id = AgentId::new();

        let mut local =
            sample_agent_with_stats("local", AgentListingStatus::Hireable, vec![], 1, 0.0, 0.0, 0);
        local.agent_id = shared_id;

        let mut owned =
            sample_agent_with_stats("owned", AgentListingStatus::Hireable, vec![], 5, 0.0, 0.0, 0);
        owned.agent_id = shared_id;

        let mut market = sample_agent_with_stats(
            "market",
            AgentListingStatus::Hireable,
            vec![],
            42,
            0.0,
            0.0,
            0,
        );
        market.agent_id = shared_id;

        let result = union_hireable_by_id(vec![local], vec![owned], vec![market]);

        assert_eq!(result.len(), 1, "duplicates should be deduped by agent_id");
        assert_eq!(result[0].name, "market");
        assert_eq!(result[0].jobs, 42);
    }

    #[test]
    fn union_includes_distinct_ids_from_every_source() {
        // Sanity: when every source contributes a different agent, all three
        // appear in the union. Order is HashMap-driven so we assert via set
        // membership rather than positional equality.
        let local = sample_agent("only-local", AgentListingStatus::Hireable, vec![], 0);
        let owned = sample_agent("only-owned", AgentListingStatus::Hireable, vec![], 0);
        let market = sample_agent("only-market", AgentListingStatus::Hireable, vec![], 0);

        let result = union_hireable_by_id(vec![local], vec![owned], vec![market]);

        let names: HashSet<String> = result.into_iter().map(|a| a.name).collect();
        assert_eq!(names.len(), 3);
        assert!(names.contains("only-local"));
        assert!(names.contains("only-owned"));
        assert!(names.contains("only-market"));
    }
}
