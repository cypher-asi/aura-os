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
use super::persist::{resolve_chat_session_with_pin, ChatPersistCtx, ForkInfo};

#[allow(clippy::too_many_arguments)]
pub(crate) async fn setup_project_chat_persistence(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
    force_new: bool,
    pinned_session_id: Option<&str>,
    originating_agent_id: Option<String>,
    cross_agent_depth: u32,
    from_agent_id: Option<String>,
) -> Option<(ChatPersistCtx, Option<ForkInfo>)> {
    let storage = state.storage_client.as_ref()?.clone();
    let jwt = jwt.to_string();
    let pai = agent_instance_id.to_string();
    let pid = project_id.to_string();
    let resolved = resolve_chat_session_with_pin(
        &storage,
        &jwt,
        &pai,
        &pid,
        force_new,
        pinned_session_id,
        state.session_service.as_ref(),
        state.chat_auto_fork_threshold,
    )
    .await?;
    // NOTE: `inc_auto_fork_applied` is bumped by the call site in
    // `instance_route::send_event_stream` when `fork_info.is_some()`,
    // not here, so the project chat path counts each apply exactly
    // once even when this helper is reused (e.g. from
    // `reset_instance_session` below, which deliberately does NOT
    // count as a real "next user send rolled into the new session").
    Some((
        ChatPersistCtx {
            storage,
            jwt,
            session_id: resolved.session_id,
            project_agent_id: pai,
            project_id: pid,
            // Project chats don't have an org-level agent handle to
            // broadcast — the sidebar's standalone-chat view wouldn't key
            // on a project session anyway.
            agent_id: None,
            originating_agent_id,
            cross_agent_depth,
            from_agent_id,
        },
        resolved.fork,
    ))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn setup_agent_chat_persistence(
    state: &AppState,
    agent_id: &AgentId,
    _agent_name: &str,
    jwt: &str,
    force_new: bool,
    pinned_session_id: Option<&str>,
    originating_agent_id: Option<String>,
    cross_agent_depth: u32,
    from_agent_id: Option<String>,
) -> Option<(ChatPersistCtx, Option<ForkInfo>)> {
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

    setup_agent_chat_persistence_with_matched(
        &storage,
        agent_id,
        jwt,
        force_new,
        &matching,
        pinned_session_id,
        state.session_service.as_ref(),
        state.chat_auto_fork_threshold,
        originating_agent_id,
        cross_agent_depth,
        from_agent_id,
    )
    .await
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
#[allow(clippy::too_many_arguments)]
pub(crate) async fn setup_agent_chat_persistence_with_matched(
    storage: &Arc<StorageClient>,
    agent_id: &AgentId,
    jwt: &str,
    force_new: bool,
    matching: &[aura_os_storage::StorageProjectAgent],
    pinned_session_id: Option<&str>,
    session_service: &aura_os_sessions::SessionService,
    auto_fork_threshold: f64,
    originating_agent_id: Option<String>,
    cross_agent_depth: u32,
    from_agent_id: Option<String>,
) -> Option<(ChatPersistCtx, Option<ForkInfo>)> {
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

    let resolved = match resolve_chat_session_with_pin(
        storage,
        jwt,
        &pai,
        &pid,
        force_new,
        pinned_session_id,
        session_service,
        auto_fork_threshold,
    )
    .await
    {
        Some(r) => r,
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
    // NOTE: `inc_auto_fork_applied` is bumped by the caller in
    // `agent_route::send_agent_event_stream` when `fork_info.is_some()`,
    // not here, so the agent chat path counts each apply exactly
    // once (and matches the symmetry with the project route, where
    // `instance_route::send_event_stream` is the canonical bump
    // site).
    Some((
        ChatPersistCtx {
            storage: storage.clone(),
            jwt: jwt.to_string(),
            session_id: resolved.session_id,
            project_agent_id: pai,
            project_id: pid,
            agent_id: Some(agent_id.to_string()),
            originating_agent_id,
            cross_agent_depth,
            from_agent_id,
        },
        resolved.fork,
    ))
}

/// Phase 4 widened the chat-session registry from a single
/// `String → ChatSession` map to `(session_key, model) → ChatSession`,
/// so a partition may hold multiple alive entries (one per model the
/// caller has used). Callers here only care whether ANY entry on the
/// partition is alive / what storage session it belongs to; we walk
/// the DashMap and short-circuit on the first match.
pub(super) async fn has_live_session(state: &AppState, key: &str) -> bool {
    state
        .chat_sessions
        .iter()
        .any(|entry| entry.key().session_key == key && entry.value().is_alive())
}

/// Return the storage `session_id` the live harness session (if any)
/// is currently writing into. The chat handlers compare this against
/// the caller-supplied `SendChatRequest.session_id` to decide whether
/// to evict the in-memory session before opening a new one. Without
/// the eviction the harness would keep replying with conversation
/// state from the previously-active session.
///
/// Phase 4: with `(session_key, model)` keys, multiple alive entries
/// can exist for one partition, but every entry on the same partition
/// is delegated against the same storage session — so returning the
/// first alive entry's id is correct, and the per-model variants stay
/// in sync.
pub(super) async fn live_session_storage_id(state: &AppState, key: &str) -> Option<String> {
    state
        .chat_sessions
        .iter()
        .find(|entry| entry.key().session_key == key && entry.value().is_alive())
        .map(|entry| entry.value().session_id.clone())
}

/// Drop EVERY chat-session entry that shares this `session_key`,
/// regardless of model. Phase 3 rollover-eviction and Phase 4 pin /
/// force-new flows both rely on this sweeping behaviour: when the
/// storage session is replaced (auto-fork, force_new, pin change),
/// every per-model entry on the partition is now stale and must be
/// rebuilt on the next turn so the fresh `aura_session_id` propagates
/// into outbound `/v1/messages` calls.
pub(super) async fn remove_live_session(state: &AppState, key: &str) {
    let stale_keys: Vec<crate::state::ChatSessionKey> = state
        .chat_sessions
        .iter()
        .filter(|entry| entry.key().session_key == key)
        .map(|entry| entry.key().clone())
        .collect();
    for stale in stale_keys {
        state.chat_sessions.remove(&stale);
    }
}

pub(crate) async fn reset_agent_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    let session_key = aura_os_core::harness_agent_id(&agent_id, None, None);
    remove_live_session(&state, &session_key).await;
    // `reset-session` is a destructive admin op, not a cross-agent
    // turn — there's no upstream sender to thread back into and the
    // chain depth resets to 0.
    let _ =
        setup_agent_chat_persistence(&state, &agent_id, "", &jwt, true, None, None, 0, None).await;
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
            None,
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
    let _ = setup_project_chat_persistence(
        &state,
        &project_id,
        &agent_instance_id,
        &jwt,
        true,
        None,
        // Reset endpoints aren't cross-agent turns; no sender to record
        // and the depth counter resets to 0.
        None,
        0,
        // No cross-agent display provenance either — the reset endpoint
        // is admin scope, not a chat turn.
        None,
    )
    .await;
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

        let svc = test_session_service(storage.clone());
        let ctx = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            "jwt",
            false,
            &[],
            None,
            &svc,
            0.8,
            None,
            0,
            None,
        )
        .await;

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
        let project_id = aura_os_core::ProjectId::new().to_string();
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

        let svc = test_session_service(storage.clone());
        let (ctx, fork) = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            "jwt",
            false,
            std::slice::from_ref(&project_agent),
            None,
            &svc,
            0.8,
            None,
            0,
            None,
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
        assert!(
            fork.is_none(),
            "a freshly-created chat session must not surface a fork event"
        );
        assert!(
            ctx.originating_agent_id.is_none(),
            "default call site passes None for the cross-agent sender"
        );
    }

    /// Phase 2 cross-agent reply contract: when the caller threads a
    /// non-`None` `originating_agent_id` through
    /// [`setup_agent_chat_persistence_with_matched`], it must land
    /// verbatim on the returned [`super::ChatPersistCtx`] so the Phase
    /// 3 `AssistantMessageEnd` callback can post B's reply back into
    /// A's session. Mirrors the wire field added in
    /// [`crate::dto::SendChatRequest::originating_agent_id`].
    #[tokio::test]
    async fn originating_agent_id_threads_through_to_persist_ctx() {
        let (url, _db) = start_mock_storage().await;
        let storage = Arc::new(StorageClient::with_base_url(&url));
        let agent_id = AgentId::new();
        let project_id = aura_os_core::ProjectId::new().to_string();
        let project_agent = StorageProjectAgent {
            id: "pa-orig".to_string(),
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

        let svc = test_session_service(storage.clone());
        let sender = "ceo-agent-id".to_string();
        let (ctx, _fork) = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            "jwt",
            false,
            std::slice::from_ref(&project_agent),
            None,
            &svc,
            0.8,
            Some(sender.clone()),
            2,
            None,
        )
        .await
        .expect("non-empty matching with a project_id must yield a ChatPersistCtx");

        assert_eq!(
            ctx.originating_agent_id.as_deref(),
            Some(sender.as_str()),
            "originating_agent_id must round-trip into ChatPersistCtx so Phase 3 \
             can read it on AssistantMessageEnd"
        );
        assert_eq!(
            ctx.cross_agent_depth, 2,
            "cross_agent_depth must round-trip onto ChatPersistCtx so the \
             persist task can read the inbound chain depth on AssistantMessageEnd"
        );
    }

    /// Companion to [`originating_agent_id_threads_through_to_persist_ctx`]:
    /// the new wire field [`crate::dto::SendChatRequest::from_agent_id`]
    /// must round-trip the same way through
    /// `setup_agent_chat_persistence_with_matched` so
    /// `persist_user_message` writes it into the persisted
    /// `user_message` content payload, and so the cross-agent
    /// reply path can later stamp the same field on B→A reply
    /// callbacks. Distinct from `originating_agent_id`, which
    /// exists for routing the next async reply back rather than
    /// for display-side provenance.
    #[tokio::test]
    async fn from_agent_id_threads_through_to_persist_ctx() {
        let (url, _db) = start_mock_storage().await;
        let storage = Arc::new(StorageClient::with_base_url(&url));
        let agent_id = AgentId::new();
        let project_id = aura_os_core::ProjectId::new().to_string();
        let project_agent = StorageProjectAgent {
            id: "pa-from".to_string(),
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

        let svc = test_session_service(storage.clone());
        let from_agent = "barret-agent-id".to_string();
        let (ctx, _fork) = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            "jwt",
            false,
            std::slice::from_ref(&project_agent),
            None,
            &svc,
            0.8,
            None,
            0,
            Some(from_agent.clone()),
        )
        .await
        .expect("non-empty matching with a project_id must yield a ChatPersistCtx");

        assert_eq!(
            ctx.from_agent_id.as_deref(),
            Some(from_agent.as_str()),
            "from_agent_id must round-trip into ChatPersistCtx so persist_user_message \
             writes it into the persisted user_message payload (and the chat row gets \
             the `from <agent>` badge instead of looking like a real human prompt)"
        );
    }

    /// Build a SessionService wired to the same mock storage these
    /// tests use, mirroring the helper in `persist::pin_tests`. The
    /// auto-fork branch is a no-op for the active sessions these
    /// tests create, so the SettingsStore-backed `JwtProvider` never
    /// needs a real JWT.
    fn test_session_service(storage: Arc<StorageClient>) -> aura_os_sessions::SessionService {
        let tmp = tempfile::TempDir::new().expect("temp dir for SettingsStore");
        let store = Arc::new(
            aura_os_store::SettingsStore::open(tmp.path())
                .expect("SettingsStore should open in temp dir"),
        );
        std::mem::forget(tmp);
        aura_os_sessions::SessionService::new(store, 0.8, 200_000)
            .with_storage_client(Some(storage))
    }
}
