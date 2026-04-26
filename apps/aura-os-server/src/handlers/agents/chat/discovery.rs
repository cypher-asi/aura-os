//! Project-agent discovery and storage-session ordering helpers shared
//! by every chat code path.

use std::time::Instant;

use chrono::{DateTime, Utc};
use futures_util::future::join_all;
use tracing::{info, warn};

use crate::handlers::projects;
use crate::state::{AppState, CachedAgentDiscovery, AGENT_DISCOVERY_TTL};

/// Build the lookup key for [`AppState::agent_discovery_cache`].
///
/// The JWT is part of the key so cached bindings never leak across
/// users. JWTs are opaque to us — we just treat the whole string as an
/// isolation token.
fn agent_discovery_cache_key(jwt: &str, agent_id_str: &str) -> String {
    format!("{jwt}::{agent_id_str}")
}

/// Invalidate any cached [`find_matching_project_agents`] result for
/// this `(jwt, agent_id)`. Callers that mutate bindings (e.g. the
/// lazy Home-project auto-bind path) should invoke this so the next
/// read sees the fresh state without waiting for TTL expiry.
pub(super) fn invalidate_agent_discovery_cache(state: &AppState, jwt: &str, agent_id_str: &str) {
    state
        .agent_discovery_cache
        .remove(&agent_discovery_cache_key(jwt, agent_id_str));
}

pub(crate) async fn find_matching_project_agents(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    let cache_key = agent_discovery_cache_key(jwt, agent_id_str);
    if let Some(cached) = cached_project_agents(state, &cache_key, agent_id_str) {
        return cached;
    }

    let project_ids = match list_project_ids(state, jwt, agent_id_str).await {
        Some(ids) => ids,
        None => return Vec::new(),
    };

    let matched = list_and_filter_project_agents(storage, jwt, agent_id_str, &project_ids).await;

    info!(
        matched = matched.len(),
        %agent_id_str,
        "agent matching: total project agents matched"
    );

    state.agent_discovery_cache.insert(
        cache_key,
        CachedAgentDiscovery {
            project_agents: matched.clone(),
            cached_at: Instant::now(),
        },
    );

    matched
}

fn cached_project_agents(
    state: &AppState,
    cache_key: &str,
    agent_id_str: &str,
) -> Option<Vec<aura_os_storage::StorageProjectAgent>> {
    // Short-TTL cache: the orgs → projects → project_agents fan-out
    // underneath this function is the dominant fixed cost on every
    // chat open and every chat turn. Bindings change only on explicit
    // create/delete paths, so returning a ≤30s stale result here is
    // safe and covers the cold-boot burst (active chat + sidebar
    // preview prefetches) with a single underlying walk.
    let entry = state.agent_discovery_cache.get(cache_key)?;
    if entry.cached_at.elapsed() >= AGENT_DISCOVERY_TTL {
        return None;
    }
    let matched = entry.project_agents.clone();
    info!(
        matched = matched.len(),
        %agent_id_str,
        age_ms = entry.cached_at.elapsed().as_millis() as u64,
        "agent matching: discovery cache hit"
    );
    Some(matched)
}

async fn list_project_ids(state: &AppState, jwt: &str, agent_id_str: &str) -> Option<Vec<String>> {
    let all_projects = match projects::list_all_projects_from_network(state, jwt).await {
        Ok(p) => {
            info!(
                count = p.len(),
                %agent_id_str,
                "agent matching: projects discovered from network"
            );
            p
        }
        Err(_) => match state.project_service.list_projects() {
            Ok(local) if !local.is_empty() => {
                info!(
                    count = local.len(),
                    %agent_id_str,
                    "agent matching: using local project cache (network unavailable)"
                );
                local
            }
            _ => {
                warn!(
                    %agent_id_str,
                    "agent matching: network unavailable and no local projects"
                );
                return None;
            }
        },
    };
    Some(
        all_projects
            .iter()
            .map(|p| p.project_id.to_string())
            .collect(),
    )
}

async fn list_and_filter_project_agents(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
    pids: &[String],
) -> Vec<aura_os_storage::StorageProjectAgent> {
    let futs: Vec<_> = pids
        .iter()
        .map(|pid| storage.list_project_agents(pid, jwt))
        .collect();
    let results = join_all(futs).await;

    results
        .into_iter()
        .zip(pids.iter())
        .flat_map(|(result, pid)| filter_agents_for_project(result, pid, agent_id_str))
        .collect()
}

fn filter_agents_for_project(
    result: Result<Vec<aura_os_storage::StorageProjectAgent>, aura_os_storage::StorageError>,
    pid: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    match result {
        Ok(agents) => {
            let total = agents.len();
            let filtered: Vec<_> = agents
                .into_iter()
                .filter(|a| a.agent_id.as_deref() == Some(agent_id_str))
                .map(|mut a| {
                    if a.project_id.as_ref().map_or(true, |p| p.is_empty()) {
                        a.project_id = Some(pid.to_string());
                    }
                    a
                })
                .collect();
            if total > 0 || !filtered.is_empty() {
                info!(
                    project_id = %pid,
                    total_agents = total,
                    matched = filtered.len(),
                    %agent_id_str,
                    "agent matching: project agents listed"
                );
            }
            filtered
        }
        Err(e) => {
            warn!(
                project_id = %pid,
                error = %e,
                "agent matching: failed to list project agents"
            );
            Vec::new()
        }
    }
}

pub(super) struct SessionFetchOutcome {
    pub(super) sessions: Vec<aura_os_storage::StorageSession>,
    pub(super) total_agents: usize,
    pub(super) failed_agents: usize,
    pub(super) first_error: Option<aura_os_storage::StorageError>,
}

impl SessionFetchOutcome {
    pub(super) fn all_failed(&self) -> bool {
        self.total_agents > 0 && self.failed_agents == self.total_agents
    }
}

pub(super) async fn fetch_all_sessions(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agents: &[aura_os_storage::StorageProjectAgent],
) -> SessionFetchOutcome {
    let futs: Vec<_> = agents
        .iter()
        .map(|pa| storage.list_sessions(&pa.id, jwt))
        .collect();
    let results: Vec<Result<Vec<aura_os_storage::StorageSession>, _>> = join_all(futs).await;
    let mut sessions = Vec::new();
    let mut failed_agents = 0usize;
    let mut first_error: Option<aura_os_storage::StorageError> = None;

    for (result, agent) in results.into_iter().zip(agents.iter()) {
        match result {
            Ok(sessions) => sessions,
            Err(e) => {
                failed_agents += 1;
                warn!(project_agent_id = %agent.id, error = %e, "Failed to list sessions");
                if first_error.is_none() {
                    first_error = Some(e);
                }
                Vec::new()
            }
        }
        .into_iter()
        .for_each(|session| sessions.push(session));
    }

    SessionFetchOutcome {
        sessions,
        total_agents: agents.len(),
        failed_agents,
        first_error,
    }
}

/// Produce a sortable recency key for a storage session.
///
/// Parses RFC3339 timestamps so timezone-suffixed ("...Z") and offset
/// ("+00:00") variants, or entries that include fractional seconds, compare
/// correctly — raw string compare would mis-order them. Prefers `started_at`
/// (when the session became active) then `created_at` (row creation) then
/// `updated_at` (last row mutation). Missing / unparseable timestamps sort
/// to the Unix epoch, so any session with a real timestamp always wins over
/// a session with no recency signal at all.
pub(crate) fn storage_session_sort_key(session: &aura_os_storage::StorageSession) -> DateTime<Utc> {
    let candidate = session
        .started_at
        .as_deref()
        .or(session.created_at.as_deref())
        .or(session.updated_at.as_deref());

    candidate
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|| DateTime::<Utc>::from(std::time::UNIX_EPOCH))
}

/// Pick the most recent session out of a list. No longer used by the chat
/// history loaders (they now aggregate events across all sessions so prior
/// sessions stay visible after the user starts a new session), but retained
/// because its unit tests pin down the `storage_session_sort_key` ordering
/// contract, which the loaders depend on for "oldest first" concatenation.
#[cfg(test)]
pub(super) fn latest_storage_session(
    sessions: &[aura_os_storage::StorageSession],
) -> Option<&aura_os_storage::StorageSession> {
    sessions
        .iter()
        .max_by(|left, right| storage_session_sort_key(left).cmp(&storage_session_sort_key(right)))
}
