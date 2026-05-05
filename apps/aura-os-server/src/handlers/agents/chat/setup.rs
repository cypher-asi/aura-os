//! Chat-session setup, live-session registry helpers, and the
//! `/reset` endpoints for both agent-scoped and instance-scoped chats.

use std::sync::Arc;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_storage::StorageClient;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use tracing::{info, warn};

use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

use super::discovery::{find_matching_project_agents, invalidate_agent_discovery_cache};
use super::persist::{resolve_chat_session, ChatPersistCtx};

pub(crate) async fn setup_project_chat_persistence(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    force_new: bool,
) -> Option<ChatPersistCtx> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = jwt.to_string();
    let pai = agent_instance_id.to_string();
    let pid = project_id.to_string();
    let session_id = resolve_chat_session(&storage, &jwt, &pai, &pid, force_new).await?;
    Some(ChatPersistCtx {
        storage,
        jwt,
        session_id,
        project_agent_id: pai,
        project_id: pid,
        // Project chats don't have an org-level agent handle to
        // broadcast — the sidebar's standalone-chat view wouldn't key
        // on a project session anyway.
        agent_id: None,
    })
}

pub(crate) async fn setup_agent_chat_persistence(
    state: &AppState,
    agent_id: &AgentId,
    _agent_name: &str,
    jwt: &str,
    force_new: bool,
) -> Option<ChatPersistCtx> {
    let storage = match state.storage_client.as_ref() {
        Some(s) => s.clone(),
        None => {
            warn!(%agent_id, "agent chat persistence: no storage client configured");
            return None;
        }
    };
    let mut matching =
        find_matching_project_agents(state, &storage, jwt, &agent_id.to_string()).await;

    if matching.is_empty() {
        matching = lazy_repair_home_project_binding(state, &storage, agent_id, jwt).await;
    }

    setup_agent_chat_persistence_with_matched(&storage, agent_id, jwt, force_new, &matching).await
}

/// Lazy repair: if the agent has no project binding yet (e.g. it was
/// created before the auto-binding path in `create_agent` existed, or
/// the binding attempt at create time failed transiently), try once
/// to auto-create a per-org Home project + binding here so the user's
/// first chat turn self-heals instead of surfacing the
/// `chat_persist_unavailable` error to the UI. Best-effort: if it
/// still fails we return whatever (still empty) match list we had.
///
/// `pub(super)` so the deduped chat hot path in
/// `agent_route::load_persistence_and_history` can run the same
/// self-heal without re-fetching `find_matching_project_agents` twice.
/// The original `setup_agent_chat_persistence` wrapper still calls
/// this internally for `reset_agent_session`.
pub(super) async fn lazy_repair_home_project_binding(
    state: &AppState,
    storage: &Arc<StorageClient>,
    agent_id: &AgentId,
    jwt: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
        Ok(agent) => {
            info!(
                %agent_id,
                "agent chat persistence: no project binding; attempting lazy Home-project auto-bind"
            );
            super::super::home_project::ensure_agent_home_project_and_binding(state, jwt, &agent)
                .await;
            // Bust the discovery cache so the re-read below sees
            // the just-created binding rather than the empty
            // snapshot the first call populated.
            invalidate_agent_discovery_cache(state, jwt, &agent_id.to_string());
            find_matching_project_agents(state, storage, jwt, &agent_id.to_string()).await
        }
        Err(e) => {
            warn!(
                %agent_id,
                error = %e,
                "agent chat persistence: cannot resolve agent for lazy auto-bind; giving up"
            );
            Vec::new()
        }
    }
}

/// Variant of [`setup_agent_chat_persistence`] that reuses a pre-fetched
/// `find_matching_project_agents` result. The chat handler calls
/// `find_matching_project_agents` once per turn and feeds the result
/// into both this function and the history loader so we don't double
/// the network/storage traffic for every CEO message.
pub(crate) async fn setup_agent_chat_persistence_with_matched(
    storage: &Arc<StorageClient>,
    agent_id: &AgentId,
    jwt: &str,
    force_new: bool,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Option<ChatPersistCtx> {
    let (pai, pid) = if let Some(pa) = matching.first() {
        let pid = pa.project_id.clone().unwrap_or_default();
        if pid.is_empty() {
            warn!(%agent_id, "No project_id for agent; skipping chat persistence");
            return None;
        }
        info!(
            %agent_id,
            project_agent_id = %pa.id,
            %pid,
            "agent chat persistence: matched existing project agent"
        );
        (pa.id.clone(), pid)
    } else {
        info!(
            %agent_id,
            "agent chat persistence: no matching project agents found; skipping persistence"
        );
        return None;
    };

    let session_id = match resolve_chat_session(storage, jwt, &pai, &pid, force_new).await {
        Some(sid) => sid,
        None => {
            warn!(
                %agent_id,
                %pai,
                %pid,
                "agent chat persistence: failed to resolve/create chat session"
            );
            return None;
        }
    };
    Some(ChatPersistCtx {
        storage: storage.clone(),
        jwt: jwt.to_string(),
        session_id,
        project_agent_id: pai,
        project_id: pid,
        agent_id: Some(agent_id.to_string()),
    })
}

pub(super) async fn has_live_session(state: &AppState, key: &str) -> bool {
    let reg = state.chat_sessions.lock().await;
    if let Some(s) = reg.get(key) {
        return s.is_alive();
    }
    false
}

pub(super) async fn remove_live_session(state: &AppState, key: &str) {
    let mut reg = state.chat_sessions.lock().await;
    reg.remove(key);
}

pub(crate) async fn reset_agent_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    let session_key = aura_os_core::harness_agent_id(&agent_id, None);
    remove_live_session(&state, &session_key).await;
    let _ = setup_agent_chat_persistence(&state, &agent_id, "", &jwt, true).await;
    info!(%agent_id, "Agent chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn reset_instance_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<StatusCode> {
    // Resolve the parent template id so the in-memory session_key matches
    // the partition the chat route stored under
    // (`{template}::{agent_instance_id}`). On lookup failure we fall
    // through to persistence-only reset — the live session (if any) will
    // self-heal on the next chat turn or on server restart, rather than
    // leaving a stale entry that masks a real "reset failed" signal to
    // the caller. Best-effort matches the spirit of
    // `invalidate_chat_sessions_for_agent`.
    let live_session_key = match state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
    {
        Ok(instance) => Some(aura_os_core::harness_agent_id(
            &instance.agent_id,
            Some(&agent_instance_id),
        )),
        Err(e) => {
            warn!(
                %project_id,
                %agent_instance_id,
                error = %e,
                "Instance reset: cannot resolve parent template; skipping in-memory eviction",
            );
            None
        }
    };
    if let Some(key) = live_session_key {
        remove_live_session(&state, &key).await;
    }
    let _ =
        setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &jwt, true).await;
    info!(%agent_instance_id, "Instance chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    //! Pin down the precondition that motivates the lazy
    //! Home-project repair on the chat hot path. The deduped
    //! `agent_route::load_persistence_and_history` path skips the
    //! `setup_agent_chat_persistence` wrapper and feeds a shared
    //! `find_matching_project_agents` result directly into
    //! [`setup_agent_chat_persistence_with_matched`]; without an
    //! explicit lazy repair around an empty `matching` slice the
    //! bare-agent first chat for a brand-new user surfaces a 422
    //! `missing aura_session_id` because `aura_session_id` is sourced
    //! from the returned `ChatPersistCtx`. These tests guard the
    //! contract: empty matching → `None`, populated matching →
    //! `Some(ctx)` with a real session id.
    use std::sync::Arc;

    use aura_os_core::AgentId;
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{StorageClient, StorageProjectAgent};

    use super::setup_agent_chat_persistence_with_matched;

    #[tokio::test]
    async fn empty_matching_returns_none_so_chat_hot_path_must_self_heal() {
        let (url, _db) = start_mock_storage().await;
        let storage = Arc::new(StorageClient::with_base_url(&url));
        let agent_id = AgentId::new();

        let ctx =
            setup_agent_chat_persistence_with_matched(&storage, &agent_id, "jwt", false, &[]).await;

        assert!(
            ctx.is_none(),
            "without a project_agent binding the helper must return None — \
             this is exactly the orphan state that the lazy_repair_home_project_binding \
             call in agent_route::load_persistence_and_history is responsible for healing"
        );
    }

    #[tokio::test]
    async fn populated_matching_yields_persist_ctx_with_session_id() {
        let (url, _db) = start_mock_storage().await;
        let storage = Arc::new(StorageClient::with_base_url(&url));
        let agent_id = AgentId::new();
        let project_id = "project-1".to_string();
        let project_agent = StorageProjectAgent {
            id: "pa-1".to_string(),
            project_id: Some(project_id.clone()),
            org_id: Some("org-1".to_string()),
            agent_id: Some(agent_id.to_string()),
            name: Some("agent".to_string()),
            role: None,
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            status: Some("active".to_string()),
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            instance_role: None,
            permissions: None,
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        };

        let ctx = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            "jwt",
            false,
            std::slice::from_ref(&project_agent),
        )
        .await
        .expect("non-empty matching with a project_id must yield a ChatPersistCtx");

        assert_eq!(ctx.project_id, project_id);
        assert_eq!(ctx.project_agent_id, "pa-1");
        assert_eq!(ctx.agent_id.as_deref(), Some(agent_id.to_string().as_str()));
        assert!(
            !ctx.session_id.is_empty(),
            "session_id must be populated so SessionConfig.aura_session_id passes \
             the Tier-1 chat preflight"
        );
    }
}
