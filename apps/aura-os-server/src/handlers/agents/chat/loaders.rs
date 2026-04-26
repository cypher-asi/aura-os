//! Chat-history storage loaders. Walk per-session storage events, fan
//! out reads in parallel batches, and short-circuit once the requested
//! window is filled.

use aura_os_core::{AgentId, AgentInstanceId, SessionEvent};
use aura_os_storage::StorageClient;
use futures_util::future::join_all;
use tracing::{info, warn};

use crate::state::AppState;

use super::super::conversions::events_to_session_history;
use super::constants::SESSION_FETCH_BATCH;
use super::discovery::{
    fetch_all_sessions, find_matching_project_agents, storage_session_sort_key,
};

/// Load events across sessions in chronological (oldest-first) order,
/// fanning per-session `list_events` calls out in parallel batches and
/// short-circuiting once enough events have been collected to satisfy
/// `target_size` (the caller's `limit + offset` window).
///
/// Pre-optimization this function walked every session sequentially with
/// `list_events(None, None)` — which paginates in 500-event chunks until
/// exhaustion — then the HTTP handler sliced the result down to the last
/// `limit` events. For accounts with many historical sessions that meant
/// O(total lifetime events) of storage reads on every chat open. Walking
/// newest-first with a target lets us stop after the most recent session
/// (the common case) while still returning the same chronological slice
/// the caller expected.
pub(super) async fn load_events_oldest_first_bounded(
    storage: &StorageClient,
    jwt: &str,
    sessions: &[&aura_os_storage::StorageSession],
    target_size: Option<usize>,
    default_project_agent_id: Option<&str>,
) -> Result<(Vec<SessionEvent>, usize), aura_os_storage::StorageError> {
    if sessions.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let newest_first: Vec<&aura_os_storage::StorageSession> =
        sessions.iter().rev().copied().collect();

    let (per_session_events, sessions_read) = fetch_session_events_in_batches(
        storage,
        jwt,
        &newest_first,
        target_size,
        default_project_agent_id,
    )
    .await?;

    Ok((flatten_chronological(per_session_events), sessions_read))
}

async fn fetch_session_events_in_batches(
    storage: &StorageClient,
    jwt: &str,
    newest_first: &[&aura_os_storage::StorageSession],
    target_size: Option<usize>,
    default_project_agent_id: Option<&str>,
) -> Result<(Vec<Vec<SessionEvent>>, usize), aura_os_storage::StorageError> {
    let mut per_session_events: Vec<Vec<SessionEvent>> = Vec::with_capacity(newest_first.len());
    let mut total_events = 0usize;
    let mut sessions_read = 0usize;
    for chunk in newest_first.chunks(SESSION_FETCH_BATCH) {
        let futs = chunk
            .iter()
            .map(|session| fetch_session_events(storage, jwt, session, default_project_agent_id));
        let results: Vec<Result<Vec<SessionEvent>, _>> = join_all(futs).await;
        for result in results {
            let events = result?;
            total_events += events.len();
            per_session_events.push(events);
            sessions_read += 1;
        }
        if let Some(target) = target_size {
            if total_events >= target {
                break;
            }
        }
    }
    Ok((per_session_events, sessions_read))
}

async fn fetch_session_events(
    storage: &StorageClient,
    jwt: &str,
    session: &aura_os_storage::StorageSession,
    default_project_agent_id: Option<&str>,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let storage_events = storage.list_events(&session.id, jwt, None, None).await?;
    let project_agent_id = session
        .project_agent_id
        .as_deref()
        .or(default_project_agent_id)
        .unwrap_or_default();
    let project_id = session.project_id.as_deref().unwrap_or_default();
    Ok(events_to_session_history(
        &storage_events,
        project_agent_id,
        project_id,
    ))
}

fn flatten_chronological(mut per_session_events: Vec<Vec<SessionEvent>>) -> Vec<SessionEvent> {
    // `per_session_events` is newest-session-first; reverse to chronological.
    per_session_events.reverse();
    let total: usize = per_session_events.iter().map(|s| s.len()).sum();
    let mut history = Vec::with_capacity(total);
    for events in per_session_events {
        history.extend(events);
    }
    history
}

pub(super) async fn load_latest_agent_events_from_storage_result(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
    target_size: Option<usize>,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        warn!(%agent_id, "latest agent events: no storage client available");
        return Ok(Vec::new());
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id_str).await;
    if matching.is_empty() {
        info!(
            %agent_id,
            "latest agent events: no matching project agents found — returning empty history"
        );
        return Ok(Vec::new());
    }
    let sessions_outcome = fetch_all_sessions(storage, jwt, &matching).await;
    info!(
        %agent_id,
        matched_agents = matching.len(),
        sessions = sessions_outcome.sessions.len(),
        failed_agents = sessions_outcome.failed_agents,
        "latest agent events: sessions fetched"
    );

    if sessions_outcome.all_failed() {
        if let Some(err) = sessions_outcome.first_error {
            return Err(err);
        }
    }

    // Aggregate events across ALL sessions for this agent, oldest first.
    // Each session is reconstructed independently via events_to_session_history
    // (so a dangling tool-use in one session cannot bind to a message in
    // another) and the results are concatenated. "Starting a new session"
    // therefore no longer hides prior messages from the UI — it only
    // changes which session new events get written to.
    let mut ordered: Vec<&aura_os_storage::StorageSession> =
        sessions_outcome.sessions.iter().collect();
    ordered.sort_by_key(|session| storage_session_sort_key(session));

    let (history, sessions_read) =
        load_events_oldest_first_bounded(storage, jwt, &ordered, target_size, None).await?;

    info!(
        %agent_id,
        sessions_total = ordered.len(),
        sessions_read,
        reconstructed_messages = history.len(),
        target_size,
        "latest agent events: events fetched"
    );
    Ok(history)
}

pub(super) async fn load_project_session_history(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    target_size: Option<usize>,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        return Ok(Vec::new());
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), jwt)
        .await?;
    let sessions_total = sessions.len();
    if sessions.is_empty() {
        info!(
            %agent_instance_id,
            sessions_total,
            "project session history: no sessions for agent instance"
        );
        return Ok(Vec::new());
    }

    // Aggregate events across ALL sessions for this agent instance, oldest
    // first. Each session is reconstructed independently (see comment in
    // load_latest_agent_events_from_storage_result) and concatenated so the
    // UI can display the full multi-session transcript even after the user
    // started a new session.
    let mut ordered: Vec<&aura_os_storage::StorageSession> = sessions.iter().collect();
    ordered.sort_by_key(|session| storage_session_sort_key(session));

    let instance_id_str = agent_instance_id.to_string();
    let (history, sessions_read) = load_events_oldest_first_bounded(
        storage,
        jwt,
        &ordered,
        target_size,
        Some(&instance_id_str),
    )
    .await?;

    info!(
        %agent_instance_id,
        sessions_total,
        sessions_read,
        reconstructed_messages = history.len(),
        target_size,
        "project session history loaded"
    );
    Ok(history)
}

/// Load events from only the *current* storage session for a standalone
/// agent — the most recent session by `storage_session_sort_key`, which is
/// also the session `resolve_chat_session(force_new=false)` would return.
///
/// This is the LLM-context loader — it intentionally does NOT aggregate
/// across historical sessions. After a "Clear session" reset, the current
/// session is the fresh empty one just created by
/// `setup_agent_chat_persistence(force_new=true)`, so no prior events
/// (including any corrupted `tool_use` blocks left over from a crashed
/// harness) can be re-injected into the model context. UI endpoints still
/// call the aggregating loaders so prior messages remain visible in the
/// chat timeline.
async fn load_current_session_events_for_agent_result(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        warn!(%agent_id, "current agent session: no storage client available");
        return Ok(Vec::new());
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, jwt, &agent_id_str).await;
    load_current_session_events_for_agent_with_matched_result(storage, agent_id, jwt, &matching)
        .await
}

/// Variant of [`load_current_session_events_for_agent_result`] that
/// reuses a pre-fetched `find_matching_project_agents` result so the
/// chat handler doesn't re-run the `list_orgs` / `list_projects` /
/// `list_project_agents` fan-out twice per turn.
async fn load_current_session_events_for_agent_with_matched_result(
    storage: &StorageClient,
    agent_id: &AgentId,
    jwt: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    if matching.is_empty() {
        info!(
            %agent_id,
            "current agent session: no matching project agents found — returning empty history"
        );
        return Ok(Vec::new());
    }
    let sessions_outcome = fetch_all_sessions(storage, jwt, matching).await;
    if sessions_outcome.all_failed() {
        if let Some(err) = sessions_outcome.first_error {
            return Err(err);
        }
    }

    let Some(latest) = sessions_outcome
        .sessions
        .iter()
        .max_by_key(|s| storage_session_sort_key(s))
    else {
        return Ok(Vec::new());
    };

    info!(
        %agent_id,
        session_id = %latest.id,
        "current agent session: loading events from latest storage session only"
    );
    let storage_events = storage.list_events(&latest.id, jwt, None, None).await?;
    Ok(events_to_session_history(
        &storage_events,
        latest.project_agent_id.as_deref().unwrap_or_default(),
        latest.project_id.as_deref().unwrap_or_default(),
    ))
}

pub async fn load_current_session_events_for_agent(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> Vec<SessionEvent> {
    match load_current_session_events_for_agent_result(state, agent_id, jwt).await {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to load current agent session from storage");
            Vec::new()
        }
    }
}

pub async fn load_current_session_events_for_agent_with_matched(
    storage: &StorageClient,
    agent_id: &AgentId,
    jwt: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Vec<SessionEvent> {
    match load_current_session_events_for_agent_with_matched_result(
        storage, agent_id, jwt, matching,
    )
    .await
    {
        Ok(messages) => messages,
        Err(e) => {
            warn!(error = %e, %agent_id, "failed to load current agent session from storage");
            Vec::new()
        }
    }
}

/// Instance-scoped analogue of `load_current_session_events_for_agent` — used
/// by the harness chat path for project-bound agent instances. Loads events
/// from only the newest storage session for the instance.
pub async fn load_current_session_events_for_instance(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    let Some(ref storage) = state.storage_client else {
        return Ok(Vec::new());
    };
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), jwt)
        .await?;
    if sessions.is_empty() {
        return Ok(Vec::new());
    }

    let Some(latest) = sessions.iter().max_by_key(|s| storage_session_sort_key(s)) else {
        return Ok(Vec::new());
    };

    info!(
        %agent_instance_id,
        session_id = %latest.id,
        "current instance session: loading events from latest storage session only"
    );
    let storage_events = storage.list_events(&latest.id, jwt, None, None).await?;
    Ok(events_to_session_history(
        &storage_events,
        &agent_instance_id.to_string(),
        latest.project_id.as_deref().unwrap_or_default(),
    ))
}
