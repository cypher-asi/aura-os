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
use tracing::warn;

use aura_os_core::listing_status::AgentListingStatus;
use aura_os_core::{Agent, AgentId};
use aura_os_network::{NetworkClient, NetworkProfile};

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

    let source_agents = load_hireable_agents(&state, &jwt).await?;
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

async fn load_hireable_agents(state: &AppState, jwt: &str) -> ApiResult<Vec<Agent>> {
    let agents = match state.network_client.as_ref() {
        Some(client) => {
            let net_agents = client.list_agents(jwt).await.map_err(map_network_error)?;
            net_agents
                .iter()
                .map(|na| {
                    let mut agent = agent_from_network(na);
                    let _ = state.agent_service.apply_runtime_config(&mut agent);
                    agent
                })
                .collect::<Vec<_>>()
        }
        None => state
            .agent_service
            .list_agents()
            .map_err(|e| ApiError::internal(format!("listing agents: {e}")))?,
    };

    Ok(agents.into_iter().filter(agent_is_hireable).collect())
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
}
