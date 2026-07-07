//! Chat-persistence setup helpers: resolve a chat session against
//! storage, build a `ChatPersistCtx`, and run the lazy Home-project
//! repair when the agent has no project binding yet.

use std::sync::Arc;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_storage::StorageClient;
use chrono::{DateTime, Utc};
use futures_util::future::join_all;
use tracing::{info, warn};

use crate::state::AppState;

use super::super::super::sessions::storage_session_is_deleted;
use super::super::discovery::{
    find_matching_project_agents, invalidate_agent_discovery_cache, storage_session_sort_key,
};
use super::super::persist::{
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
pub(in super::super) async fn lazy_repair_home_project_binding(
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
            super::super::super::home_project::ensure_agent_home_project_and_binding(
                state, jwt, &agent,
            )
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
    // Choose which project binding this write lands on.
    //
    // For an unpinned write (no `session_id`, not `force_new`) we must
    // mirror the UI's default-session selection, which picks the
    // globally most-recent session across *all* of the agent's bindings
    // (`findMostRecentRealSession` / `sortSessionsDesc` in
    // `interface/src/stores/sessions-list-store.ts`). The historical
    // `matching.first()` pick used project-list order instead, so a
    // cross-agent `send_to_agent` delivery (which never carries a
    // `session_id`) could persist onto a different binding than the one
    // the recipient's chat panel opens — the message saved
    // (`x-aura-chat-persisted: true`) yet the panel rendered empty. A
    // pinned/force_new write already names its session, so it keeps the
    // first-binding behavior (the pin is resolved per-binding downstream).
    let selected = if !request.force_new && request.pinned_session_id.is_none() {
        select_write_binding(storage, request.jwt, matching).await
    } else {
        matching.first()
    };

    let (pai, pid) = if let Some(pa) = selected {
        let pid = pa.project_id.clone().unwrap_or_default();
        if pid.is_empty() {
            warn!(%agent_id, "No project_id for agent; skipping chat persistence");
            return None;
        }
        info!(
            %agent_id,
            project_agent_id = %pa.id,
            %pid,
            binding_count = matching.len(),
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

/// Pick the project binding an unpinned write should land on: the one
/// that owns the globally most-recent session across all of the agent's
/// bindings. This is the server-side mirror of the UI default-session
/// redirect, so a writer (notably the cross-agent reply/delivery path)
/// and the reader can never diverge onto different bindings.
///
/// Single binding (or none) needs no disambiguation and skips the
/// extra `list_sessions` fan-out. If no binding has any session yet,
/// fall back to the first binding so a brand-new agent still self-heals
/// by creating its first session there (matching the prior behavior).
async fn select_write_binding<'a>(
    storage: &Arc<StorageClient>,
    jwt: &str,
    matching: &'a [aura_os_storage::StorageProjectAgent],
) -> Option<&'a aura_os_storage::StorageProjectAgent> {
    if matching.len() <= 1 {
        return matching.first();
    }

    let futs: Vec<_> = matching
        .iter()
        .map(|pa| storage.list_sessions(&pa.id, jwt))
        .collect();
    let keys: Vec<Option<DateTime<Utc>>> = join_all(futs)
        .await
        .into_iter()
        .zip(matching.iter())
        .map(|(result, pa)| match result {
            Ok(sessions) => sessions
                .iter()
                .filter(|session| !storage_session_is_deleted(session))
                .map(storage_session_sort_key)
                .max(),
            Err(e) => {
                warn!(
                    project_agent_id = %pa.id,
                    error = %e,
                    "select_write_binding: failed to list sessions; binding treated as empty"
                );
                None
            }
        })
        .collect();

    let index = pick_newest_binding_index(&keys).unwrap_or(0);
    matching.get(index).or_else(|| matching.first())
}

/// Pure helper: given each binding's newest-session recency key (or
/// `None` when a binding has no sessions), return the index of the
/// binding with the most-recent session. Ties resolve to the earliest
/// index, so the choice stays stable and matches the legacy
/// `matching.first()` pick when recency is indistinguishable. Returns
/// `None` only when every binding is empty.
fn pick_newest_binding_index(keys: &[Option<DateTime<Utc>>]) -> Option<usize> {
    let mut best: Option<(usize, DateTime<Utc>)> = None;
    for (i, key) in keys.iter().enumerate() {
        if let Some(key) = key {
            match best {
                // `>=` keeps the earlier index on ties.
                Some((_, best_key)) if best_key >= *key => {}
                _ => best = Some((i, *key)),
            }
        }
    }
    best.map(|(index, _)| index)
}

#[cfg(test)]
mod tests {
    //! Pin down the precondition that motivates the lazy
    //! Home-project repair on the chat hot path. The deduped
    //! `agent_route::load_persistence_only` path skips the
    //! `setup_agent_chat_persistence` wrapper and feeds a shared
    //! `find_matching_project_agents` result directly into
    //! [`setup_agent_chat_persistence_with_matched`]; without an
    //! explicit lazy repair around an empty `matching` slice the
    //! bare-agent first chat for a brand-new user surfaces a 422
    //! `missing aura_session_id`.
    use std::sync::Arc;

    use aura_os_core::AgentId;
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{StorageClient, StorageProjectAgent};

    use chrono::{DateTime, TimeZone, Utc};

    use super::super::super::persist::{ChatPersistRequest, ChatSessionResolveDeps};
    use super::{pick_newest_binding_index, setup_agent_chat_persistence_with_matched};

    fn ts(secs: i64) -> Option<DateTime<Utc>> {
        Some(Utc.timestamp_opt(secs, 0).unwrap())
    }

    /// The cross-agent empty-chat bug: an unpinned write must land on
    /// the binding owning the globally newest session, not the first
    /// binding by project-list order. This pins the selection that
    /// `select_write_binding` feeds into `setup_agent_chat_persistence_*`.
    #[test]
    fn picks_binding_with_globally_newest_session() {
        // Binding 1 owns the newest session even though binding 0 is first.
        assert_eq!(
            pick_newest_binding_index(&[ts(100), ts(200), ts(150)]),
            Some(1),
        );
    }

    #[test]
    fn newest_binding_ties_resolve_to_earliest_index() {
        // On a recency tie the earliest binding wins, matching the
        // legacy `matching.first()` behavior so we never reshuffle a
        // stable single-newest pick.
        assert_eq!(pick_newest_binding_index(&[ts(200), ts(200)]), Some(0));
    }

    #[test]
    fn newest_binding_skips_empty_bindings() {
        // A binding with no sessions (None) must never outrank one that
        // has a real session.
        assert_eq!(pick_newest_binding_index(&[None, ts(50), None]), Some(1));
    }

    #[test]
    fn newest_binding_all_empty_is_none() {
        assert_eq!(pick_newest_binding_index(&[None, None]), None);
    }

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
            source: None,
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
            source: None,
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
            source: None,
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
}
