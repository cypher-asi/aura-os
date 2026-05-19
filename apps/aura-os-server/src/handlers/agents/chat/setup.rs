//! Chat-session setup, live-session registry helpers, and the
//! `/reset` endpoints for both agent-scoped and instance-scoped chats.

use std::sync::Arc;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_harness::HarnessInbound;
use aura_os_storage::StorageClient;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use tracing::{info, warn};

use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

use super::discovery::{find_matching_project_agents, invalidate_agent_discovery_cache};
use super::persist::{
    resolve_chat_session_with_pin, ChatPersistCtx, ChatPersistRequest, ChatSessionResolveDeps,
    ForkInfo,
};

pub(crate) async fn setup_project_chat_persistence(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    request: &ChatPersistRequest<'_>,
) -> Option<(ChatPersistCtx, Option<ForkInfo>)> {
    let storage = state.storage_client.as_ref()?.clone();
    let pai = agent_instance_id.to_string();
    let pid = project_id.to_string();
    let deps = ChatSessionResolveDeps {
        session_service: state.session_service.as_ref(),
        auto_fork_threshold: state.chat_auto_fork_threshold,
    };
    let resolved = resolve_chat_session_with_pin(&storage, &pai, &pid, request, &deps).await?;
    // NOTE: `inc_auto_fork_applied` is bumped by the call site in
    // `instance_route::send_event_stream` when `fork_info.is_some()`,
    // not here, so the project chat path counts each apply exactly
    // once even when this helper is reused (e.g. from
    // `reset_instance_session` below, which deliberately does NOT
    // count as a real "next user send rolled into the new session").
    Some((
        ChatPersistCtx {
            storage,
            jwt: request.jwt.to_string(),
            session_id: resolved.session_id,
            project_agent_id: pai,
            project_id: pid,
            // Project chats don't have an org-level agent handle to
            // broadcast — the sidebar's standalone-chat view wouldn't key
            // on a project session anyway.
            agent_id: None,
            originating_agent_id: request.originating_agent_id.map(ToString::to_string),
            cross_agent_depth: request.cross_agent_depth,
            from_agent_id: request.from_agent_id.map(ToString::to_string),
        },
        resolved.fork,
    ))
}

pub(crate) async fn setup_agent_chat_persistence(
    state: &AppState,
    agent_id: &AgentId,
    request: &ChatPersistRequest<'_>,
) -> Option<(ChatPersistCtx, Option<ForkInfo>)> {
    let storage = match state.storage_client.as_ref() {
        Some(s) => s.clone(),
        None => {
            warn!(%agent_id, "agent chat persistence: no storage client configured");
            return None;
        }
    };
    let mut matching =
        find_matching_project_agents(state, &storage, request.jwt, &agent_id.to_string()).await;

    if matching.is_empty() {
        matching = lazy_repair_home_project_binding(state, &storage, agent_id, request.jwt).await;
    }

    let deps = ChatSessionResolveDeps {
        session_service: state.session_service.as_ref(),
        auto_fork_threshold: state.chat_auto_fork_threshold,
    };
    setup_agent_chat_persistence_with_matched(&storage, agent_id, &matching, request, &deps).await
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
/// `agent_route::load_persistence_only` can run the same
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
    matching: &[aura_os_storage::StorageProjectAgent],
    request: &ChatPersistRequest<'_>,
    deps: &ChatSessionResolveDeps<'_>,
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

    let resolved = match resolve_chat_session_with_pin(storage, &pai, &pid, request, deps).await {
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
            jwt: request.jwt.to_string(),
            session_id: resolved.session_id,
            project_agent_id: pai,
            project_id: pid,
            agent_id: Some(agent_id.to_string()),
            originating_agent_id: request.originating_agent_id.map(ToString::to_string),
            cross_agent_depth: request.cross_agent_depth,
            from_agent_id: request.from_agent_id.map(ToString::to_string),
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

/// Drop EVERY chat-session entry whose `session_key` matches — or
/// is a per-session extension of — the given partition prefix,
/// regardless of model or storage session. Used by both
/// [`reset_agent_session`] (bare-template partition) and
/// [`reset_instance_session`] (instance partition) to evict every
/// per-session entry under one partition in a single sweep, since
/// after Phase 1 of parallel-session-chats the registry holds one
/// entry per `(template, instance|default, storage_session)` triple
/// instead of one per partition.
///
/// The helper is partition-shape-agnostic: callers pass whichever
/// `harness_agent_id` they own (two-segment bare-template, two-segment
/// instance, etc.) and the prefix sweep handles the three-segment
/// children uniformly.
///
/// The `==` branch covers the legacy two-segment form (callers that
/// did not opt into a session segment, e.g. before
/// `harness_agent_id` accepted a `SessionId`); the `starts_with`
/// branch covers every three-segment per-session entry.
pub(super) async fn remove_live_sessions_for_partition(state: &AppState, partition: &str) {
    let prefix = format!("{partition}::");
    let stale_keys: Vec<crate::state::ChatSessionKey> = state
        .chat_sessions
        .iter()
        .filter(|entry| {
            entry.key().session_key == partition || entry.key().session_key.starts_with(&prefix)
        })
        .map(|entry| entry.key().clone())
        .collect();
    for stale in stale_keys {
        state.chat_sessions.remove(&stale);
    }
}

/// Sweep every chat-session entry under `partition` and forward
/// [`HarnessInbound::Cancel`] to each one's harness command channel,
/// then evict the entries from the registry.
///
/// Phase 7 cancel-turn flow: the explicit `/cancel-turn` HTTP routes
/// land here, and the SSE drop guard in `streaming.rs` performs the
/// equivalent cleanup directly through the slot-release sentinel
/// (single live entry, no full registry sweep) — both paths
/// converge on the same harness contract:
///
/// 1. **Forward `Cancel`** so the harness aborts its in-flight turn
///    and emits its own terminal event for the persist task. Without
///    this, a long-running plan-mode turn full of non-terminal
///    `Progress` heartbeats can keep the per-partition turn slot
///    held indefinitely (the stuck-after-Stop bug).
/// 2. **Evict the warm session**. Forces the next user message on
///    the same partition to cold-start with a fresh harness session
///    and replay history through the latest compaction logic, instead
///    of reusing the wedged session whose `acquire_turn_slot` may
///    block until a 90s SSE idle timeout.
///
/// Best-effort throughout. A `try_send` failure (channel closed,
/// queue full) is logged and swallowed; the registry eviction still
/// proceeds so the next request always cold-starts cleanly.
///
/// Same partition-shape contract as
/// [`remove_live_sessions_for_partition`]: pass either the
/// two-segment bare-template / bare-instance partition or any
/// three-segment per-session prefix and the sweep handles the
/// children uniformly.
pub(super) async fn cancel_live_sessions_for_partition(state: &AppState, partition: &str) {
    cancel_live_sessions_in_registry(&state.chat_sessions, partition).await;
}

/// Registry-only worker for [`cancel_live_sessions_for_partition`].
/// Pulled out so unit tests can exercise the harness-cancel + evict
/// behaviour against a hand-built `ChatSessionRegistry` without
/// having to construct a full [`AppState`] (which threads through
/// every aura-os service binding and is impractical to fake at the
/// chat-handler unit-test layer).
pub(super) async fn cancel_live_sessions_in_registry(
    registry: &crate::state::ChatSessionRegistry,
    partition: &str,
) {
    let prefix = format!("{partition}::");
    let matching_keys: Vec<crate::state::ChatSessionKey> = registry
        .iter()
        .filter(|entry| {
            entry.key().session_key == partition || entry.key().session_key.starts_with(&prefix)
        })
        .map(|entry| entry.key().clone())
        .collect();

    for key in &matching_keys {
        if let Some(entry) = registry.get(key) {
            // Cloning the sender is cheap (mpsc::Sender is an Arc
            // under the hood) and lets us drop the registry `Ref`
            // before awaiting / mutating the map.
            let commands_tx = entry.commands_tx.clone();
            drop(entry);
            if let Err(err) = commands_tx.try_send(HarnessInbound::Cancel) {
                warn!(
                    partition,
                    session_key = %key.session_key,
                    error = %err,
                    "cancel-turn: failed to forward Cancel to harness; evicting registry entry anyway"
                );
            } else {
                info!(
                    partition,
                    session_key = %key.session_key,
                    "cancel-turn: forwarded Cancel to harness"
                );
            }
        }
    }

    // Evict every matching entry so the next user message cold-starts
    // a fresh harness session instead of reusing the cancelled one.
    // Inlined the same partition-shape rules as
    // `remove_live_sessions_for_partition` so the helper can run on a
    // bare `ChatSessionRegistry` without going through `AppState`.
    let stale_keys: Vec<crate::state::ChatSessionKey> = registry
        .iter()
        .filter(|entry| {
            entry.key().session_key == partition || entry.key().session_key.starts_with(&prefix)
        })
        .map(|entry| entry.key().clone())
        .collect();
    for stale in stale_keys {
        registry.remove(&stale);
    }
}

pub(crate) async fn reset_agent_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    // The bare-template partition string is exactly the prefix that
    // sweeps `{template}::default` (legacy two-segment, == branch)
    // plus every `{template}::default::{session_id}` entry that the
    // Phase 1 chat route writes (three-segment, starts_with branch).
    // Exact-match eviction would silently no-op on every modern
    // bare-agent chat and leak the turn_slot mutex indefinitely.
    let partition = aura_os_core::harness_agent_id(&agent_id, None, None);
    remove_live_sessions_for_partition(&state, &partition).await;
    // `reset-session` is a destructive admin op, not a cross-agent
    // turn — there's no upstream sender to thread back into and the
    // chain depth resets to 0.
    let request = ChatPersistRequest {
        jwt: &jwt,
        force_new: true,
        pinned_session_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    };
    let _ = setup_agent_chat_persistence(&state, &agent_id, &request).await;
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
        // The `live_session_key` built above is the two-segment
        // instance partition (`harness_agent_id(template, Some(instance), None)`).
        // After Phase 1 of parallel-session-chats the chat routes
        // store per-session entries under three-segment keys whose
        // prefix is exactly that string + `"::"`, so the prefix sweep
        // evicts every storage session under this instance in one
        // pass. The legacy two-segment form (callers that opted out
        // of the session segment) is covered by the `==` branch in
        // `remove_live_sessions_for_partition`.
        remove_live_sessions_for_partition(&state, &key).await;
    }
    // Reset endpoints aren't cross-agent turns; no sender to record,
    // the depth counter resets to 0, and there's no display-side
    // provenance to thread — the reset endpoint is admin scope, not
    // a chat turn.
    let request = ChatPersistRequest {
        jwt: &jwt,
        force_new: true,
        pinned_session_id: None,
        originating_agent_id: None,
        cross_agent_depth: 0,
        from_agent_id: None,
    };
    let _ = setup_project_chat_persistence(&state, &project_id, &agent_instance_id, &request).await;
    info!(%agent_instance_id, "Instance chat session reset");
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/agents/:agent_id/cancel-turn`
///
/// Phase 7 Stop / refresh cleanup: forward
/// [`HarnessInbound::Cancel`] to every live `ChatSession` on the
/// bare-template partition and evict them so the next user message
/// cold-starts with a fresh harness session. Idempotent — calling it
/// when no live session exists is a no-op (and still returns 204).
///
/// Counterpart to [`reset_agent_session`] but intentionally lighter:
/// `reset-session` is a destructive admin op that mints a brand-new
/// storage session row for the next turn; `cancel-turn` only unsticks
/// the partition so a stuck turn no longer blocks subsequent sends,
/// keeping the storage session continuity.
pub(crate) async fn cancel_agent_turn(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    let partition = aura_os_core::harness_agent_id(&agent_id, None, None);
    cancel_live_sessions_for_partition(&state, &partition).await;
    info!(%agent_id, "Agent chat turn cancelled");
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/projects/:project_id/agents/:agent_instance_id/cancel-turn`
///
/// Phase 7 Stop / refresh cleanup for the project / instance chat
/// route. Resolves the parent template id so the partition prefix
/// matches the `{template}::{instance}::{session_id}` shape the chat
/// route stores under, then sweeps every per-session entry under that
/// instance.
///
/// Counterpart to [`reset_instance_session`]; see [`cancel_agent_turn`]
/// for the contract distinction.
pub(crate) async fn cancel_instance_turn(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<StatusCode> {
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
                "Instance cancel-turn: cannot resolve parent template; skipping in-memory cleanup",
            );
            None
        }
    };
    if let Some(key) = live_session_key {
        cancel_live_sessions_for_partition(&state, &key).await;
    }
    info!(%agent_instance_id, "Instance chat turn cancelled");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    //! Two clusters of tests live here:
    //!
    //! 1. Pin down the precondition that motivates the lazy
    //!    Home-project repair on the chat hot path. The deduped
    //!    `agent_route::load_persistence_only` path skips the
    //!    `setup_agent_chat_persistence` wrapper and feeds a shared
    //!    `find_matching_project_agents` result directly into
    //!    [`setup_agent_chat_persistence_with_matched`]; without an
    //!    explicit lazy repair around an empty `matching` slice the
    //!    bare-agent first chat for a brand-new user surfaces a 422
    //!    `missing aura_session_id`.
    //! 2. Phase 7 `cancel-turn` cleanup contract: pin the harness-
    //!    cancel forwarding and registry eviction so a stuck Stop
    //!    can never wedge the per-partition turn slot.
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::time::Duration;

    use aura_os_core::AgentId;
    use aura_os_harness::{HarnessInbound, HarnessOutbound};
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{StorageClient, StorageProjectAgent};
    use dashmap::DashMap;
    use tokio::sync::{broadcast, mpsc, Mutex};

    use crate::state::{ChatSession, ChatSessionKey, ChatSessionRegistry};

    use super::super::persist::{ChatPersistRequest, ChatSessionResolveDeps};
    use super::{cancel_live_sessions_in_registry, setup_agent_chat_persistence_with_matched};

    #[tokio::test]
    async fn empty_matching_returns_none_so_chat_hot_path_must_self_heal() {
        let (url, _db) = start_mock_storage().await;
        let storage = Arc::new(StorageClient::with_base_url(&url));
        let agent_id = AgentId::new();

        let svc = test_session_service(storage.clone());
        let request = ChatPersistRequest {
            jwt: "jwt",
            force_new: false,
            pinned_session_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        };
        let deps = ChatSessionResolveDeps {
            session_service: &svc,
            auto_fork_threshold: 0.8,
        };
        let ctx =
            setup_agent_chat_persistence_with_matched(&storage, &agent_id, &[], &request, &deps)
                .await;

        assert!(
            ctx.is_none(),
            "without a project_agent binding the helper must return None — \
             this is exactly the orphan state that the lazy_repair_home_project_binding \
             call in agent_route::load_persistence_only is responsible for healing"
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
        let request = ChatPersistRequest {
            jwt: "jwt",
            force_new: false,
            pinned_session_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        };
        let deps = ChatSessionResolveDeps {
            session_service: &svc,
            auto_fork_threshold: 0.8,
        };
        let (ctx, fork) = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            std::slice::from_ref(&project_agent),
            &request,
            &deps,
        )
        .await
        .expect("non-empty matching with a project_id must yield a ChatPersistCtx");

        assert_eq!(ctx.project_id, project_id);
        assert_eq!(ctx.project_agent_id, "pa-1");
        assert_eq!(ctx.agent_id.as_deref(), Some(agent_id.to_string().as_str()));
        assert_ne!(
            ctx.session_id,
            aura_os_core::SessionId::nil(),
            "session_id must be populated (non-nil) so SessionConfig.aura_session_id \
             passes the Tier-1 chat preflight"
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
        let request = ChatPersistRequest {
            jwt: "jwt",
            force_new: false,
            pinned_session_id: None,
            originating_agent_id: Some(sender.as_str()),
            cross_agent_depth: 2,
            from_agent_id: None,
        };
        let deps = ChatSessionResolveDeps {
            session_service: &svc,
            auto_fork_threshold: 0.8,
        };
        let (ctx, _fork) = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            std::slice::from_ref(&project_agent),
            &request,
            &deps,
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
        let request = ChatPersistRequest {
            jwt: "jwt",
            force_new: false,
            pinned_session_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: Some(from_agent.as_str()),
        };
        let deps = ChatSessionResolveDeps {
            session_service: &svc,
            auto_fork_threshold: 0.8,
        };
        let (ctx, _fork) = setup_agent_chat_persistence_with_matched(
            &storage,
            &agent_id,
            std::slice::from_ref(&project_agent),
            &request,
            &deps,
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

    /// Inserts a `ChatSession` whose harness `commands_tx` is wired
    /// to a stand-in mpsc receiver the test can drain. Returns the
    /// receiver alongside the registry insertion key so the caller
    /// can assert what (if anything) was forwarded to the harness.
    fn insert_fake_chat_session(
        registry: &ChatSessionRegistry,
        session_key: &str,
    ) -> mpsc::Receiver<HarnessInbound> {
        let (commands_tx, commands_rx) = mpsc::channel::<HarnessInbound>(4);
        let (events_tx, _events_rx) = broadcast::channel::<HarnessOutbound>(8);
        registry.insert(
            ChatSessionKey::new(session_key, None),
            ChatSession {
                session_id: format!("session-{session_key}"),
                commands_tx,
                events_tx,
                model: None,
                agent_id: Some(session_key.to_string()),
                template_agent_id: None,
                turn_slot: Arc::new(Mutex::new(())),
                turn_pending_count: Arc::new(AtomicUsize::new(0)),
            },
        );
        commands_rx
    }

    /// Phase 7 cancel-turn contract: the helper must forward
    /// `HarnessInbound::Cancel` to the live session's command channel
    /// AND evict the registry entry so a subsequent send cold-starts
    /// a fresh session instead of reusing the cancelled one.
    #[tokio::test]
    async fn cancel_live_sessions_forwards_cancel_and_evicts_partition_entry() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        let partition = "agent-template::ai-1::session-x";
        let mut commands_rx = insert_fake_chat_session(&registry, partition);

        cancel_live_sessions_in_registry(&registry, partition).await;

        let observed = tokio::time::timeout(Duration::from_millis(100), commands_rx.recv())
            .await
            .expect("Cancel must be forwarded before timeout")
            .expect("commands_tx still open");
        assert!(
            matches!(observed, HarnessInbound::Cancel),
            "cancel-turn must forward HarnessInbound::Cancel; got {observed:?}",
        );

        assert!(
            registry
                .get(&ChatSessionKey::new(partition, None))
                .is_none(),
            "cancel-turn must evict the partition entry so the next user message cold-starts",
        );
    }

    /// Three-segment per-session entries (the per-`session_id` prefix
    /// the chat routes write under after Phase 1 of parallel-session
    /// chats) must all be swept when the caller passes the two-segment
    /// `{template}::{instance}` partition prefix — same contract as
    /// `remove_live_sessions_for_partition`. Without this the cancel
    /// would unstick exactly one session and leave its siblings under
    /// the same instance still wedged.
    #[tokio::test]
    async fn cancel_live_sessions_sweeps_three_segment_session_children() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        let instance_partition = "agent-template::ai-1";
        let session_a = "agent-template::ai-1::session-a";
        let session_b = "agent-template::ai-1::session-b";
        let unrelated = "agent-template::ai-2::session-z";

        let mut commands_rx_a = insert_fake_chat_session(&registry, session_a);
        let mut commands_rx_b = insert_fake_chat_session(&registry, session_b);
        let _commands_rx_unrelated = insert_fake_chat_session(&registry, unrelated);

        cancel_live_sessions_in_registry(&registry, instance_partition).await;

        // Both three-segment children must observe a forwarded Cancel.
        for (label, rx) in [
            ("session-a", &mut commands_rx_a),
            ("session-b", &mut commands_rx_b),
        ] {
            let observed = tokio::time::timeout(Duration::from_millis(100), rx.recv())
                .await
                .unwrap_or_else(|_| panic!("{label} must observe forwarded Cancel"))
                .expect("commands_tx still open");
            assert!(
                matches!(observed, HarnessInbound::Cancel),
                "{label} must observe HarnessInbound::Cancel; got {observed:?}",
            );
        }

        // ...and the eviction sweep must drop both children but leave
        // the unrelated sibling instance alone (sharing only a template
        // prefix is not enough to belong to this partition).
        assert!(registry
            .get(&ChatSessionKey::new(session_a, None))
            .is_none());
        assert!(registry
            .get(&ChatSessionKey::new(session_b, None))
            .is_none());
        assert!(
            registry
                .get(&ChatSessionKey::new(unrelated, None))
                .is_some(),
            "cancel-turn for ai-1 must NOT touch sibling instance ai-2 — partition prefix is exact",
        );
    }

    /// Idempotency guard: calling `cancel-turn` against a partition
    /// that has no live registry entries is a no-op (and must not
    /// panic). Backs the `204 No Content` semantics of the public
    /// `/cancel-turn` HTTP routes when no chat is in flight.
    #[tokio::test]
    async fn cancel_live_sessions_is_a_noop_on_empty_partition() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        // Insert an entry on a different partition to prove the sweep
        // is scoped: the unrelated entry must survive intact.
        let unrelated = "agent-template-other::ai-z::session-z";
        let _commands_rx = insert_fake_chat_session(&registry, unrelated);

        cancel_live_sessions_in_registry(&registry, "missing-template::ai-x").await;

        assert!(
            registry
                .get(&ChatSessionKey::new(unrelated, None))
                .is_some(),
            "cancel-turn for an empty partition must not evict unrelated entries",
        );
    }
}
