//! Persistence + history loaders for the bare-agent chat route.
//! Splits the "resolve persist + matching" work out of the route
//! handler so the cold-vs-warm history slice can run after the
//! `session_key` is known.

use aura_os_core::{AgentId, SessionEvent, SessionId};
use aura_os_harness::ConversationMessage;
use tracing::{error, info, warn};

use crate::state::AppState;

use super::super::compaction::session_events_to_conversation_history;
use super::super::constants::{
    CONVERSATION_HISTORY_WARN_BYTES, DEFAULT_AGENT_HISTORY_WINDOW_LIMIT,
};
use super::super::discovery::find_matching_project_agents;
use super::super::loaders::{
    load_current_session_events_for_agent_with_matched, load_pinned_session_events_for_agent,
};
use super::super::persist::{ChatPersistCtx, ChatPersistRequest, ChatSessionResolveDeps, ForkInfo};
use super::super::request::slice_recent_agent_events;
use super::super::setup::{
    lazy_repair_home_project_binding, setup_agent_chat_persistence_with_matched,
};

/// Resolve `ChatPersistCtx` and fork state without loading any
/// conversation history. The returned `matching` list is the
/// one-time-fetched `find_matching_project_agents` result that the
/// downstream [`load_history_for_agent`] reuses, preserving the
/// once-per-turn dedup that the pre-refactor combined helper had.
pub(super) async fn load_persistence_only(
    state: &AppState,
    agent_id: &AgentId,
    request: &ChatPersistRequest<'_>,
) -> (
    Option<ChatPersistCtx>,
    Option<ForkInfo>,
    Vec<aura_os_storage::StorageProjectAgent>,
) {
    let Some(ref storage) = state.storage_client else {
        return (None, None, Vec::new());
    };
    let mut matching =
        find_matching_project_agents(state, storage, request.jwt, &agent_id.to_string()).await;

    // Self-heal: if the agent has no `project_agent` binding yet
    // (typically because the best-effort auto-bind in
    // `crud::create_agent` failed transiently or `agent.org_id` wasn't
    // populated on the network record at create time), run the same
    // lazy Home-project repair the legacy `setup_agent_chat_persistence`
    // wrapper performs. Without this the deduped hot path lets a brand
    // new user's first chat fail Tier-1 preflight with
    // `missing aura_session_id` because `persist_ctx` would be `None`
    // and `SessionConfig.aura_session_id` defaults to `None`. The
    // repair busts the discovery cache and returns the refreshed match
    // list, so persist + history below see the just-created binding.
    if matching.is_empty() {
        matching = lazy_repair_home_project_binding(state, storage, agent_id, request.jwt).await;
    }

    let deps = ChatSessionResolveDeps {
        session_service: state.session_service.as_ref(),
        auto_fork_threshold: state.chat_auto_fork_threshold,
    };
    let persist_outcome =
        setup_agent_chat_persistence_with_matched(storage, agent_id, &matching, request, &deps)
            .await;
    let (persist_ctx, fork_info) = match persist_outcome {
        Some((ctx, fork)) => (Some(ctx), fork),
        None => (None, None),
    };
    (persist_ctx, fork_info, matching)
}

/// Inputs to [`load_history_for_agent`]. Bundles the per-turn flags
/// (`force_new`, `live_session`, `pinned_session_id`) with the
/// dedup-shared `matching` list and the `session_key` used for the
/// cold-vs-warm log line so the helper stays inside the
/// 5-parameter budget. Mirrors the existing `OpenChatStreamArgs`
/// pattern in `streaming.rs`.
pub(super) struct LoadAgentHistoryCtx<'a> {
    pub(super) session_key: &'a str,
    pub(super) jwt: &'a str,
    pub(super) force_new: bool,
    pub(super) live_session: bool,
    pub(super) pinned_session_id: Option<&'a SessionId>,
    pub(super) matching: &'a [aura_os_storage::StorageProjectAgent],
}

/// Load the conversation-history slice for a cold-start agent chat
/// turn, mirroring the warm-skip shape that
/// `instance_route::load_history_and_project_state` uses. Bails early
/// on `force_new` or when `live_session` is true so a warm bare-agent
/// session reuses the harness's in-memory history instead of paying
/// the storage round-trip + bounded-slice + format-conversion cost on
/// every turn. `session_key` is logged so the cold/warm transition is
/// greppable when a perf regression report points at the wrong key
/// shape. `matching` is the dedup-shared list from
/// [`load_persistence_only`].
pub(super) async fn load_history_for_agent(
    state: &AppState,
    agent_id: &AgentId,
    ctx: &LoadAgentHistoryCtx<'_>,
) -> Option<Vec<ConversationMessage>> {
    if ctx.force_new || ctx.live_session {
        return None;
    }
    let storage = state.storage_client.as_ref()?;
    info!(%agent_id, session_key = %ctx.session_key, "agent chat: cold start, loading history slice");
    let stored = match ctx.pinned_session_id {
        Some(session_id) => {
            load_pinned_history_for_agent(storage, ctx.jwt, session_id, ctx.matching)
                .await
                .unwrap_or_default()
        }
        None => {
            load_current_session_events_for_agent_with_matched(
                storage,
                agent_id,
                ctx.jwt,
                ctx.matching,
            )
            .await
        }
    };
    if stored.is_empty() {
        return None;
    }
    let bounded = slice_recent_agent_events(stored, Some(DEFAULT_AGENT_HISTORY_WINDOW_LIMIT), 0);
    Some(session_events_to_conversation_history(&bounded))
}

/// Locate the project binding the pinned `session_id` belongs to and
/// load its events. The binding lookup is what
/// `resolve_pinned_session_for_agent` already verified above; redoing
/// it here keeps the data path simple at the cost of one extra
/// `list_sessions` round trip per turn — the alternative would be
/// threading the matched binding through `load_history_for_agent`
/// just for this branch.
async fn load_pinned_history_for_agent(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    session_id: &SessionId,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    // Stringify once at this storage boundary; the loader call below
    // ultimately reaches into `storage.list_events(&str, ...)` which
    // keeps `&str` deliberately (the `aura_os_storage` REST shape).
    let session_id_str = session_id.to_string();
    for binding in matching {
        let sessions = storage.list_sessions(&binding.id, jwt).await?;
        if sessions.iter().any(|s| s.id == session_id_str) {
            let project_id = binding.project_id.as_deref().unwrap_or_default();
            return load_pinned_session_events_for_agent(
                storage,
                jwt,
                &session_id_str,
                &binding.id,
                project_id,
            )
            .await;
        }
    }
    Ok(Vec::new())
}

pub(super) fn log_persistence_status(agent_id: &AgentId, persist_ready: bool) {
    if persist_ready {
        info!(%agent_id, "agent chat: persistence context ready");
    } else {
        error!(%agent_id, "agent chat: persistence context unavailable — chat will NOT be saved");
    }
}

/// Surface the byte size of the flat-text history we're about to ship
/// into the harness `SessionConfig`. This is the cold-start payload
/// (warm sessions skip it via `get_or_create_chat_session`). A `warn!`
/// above `CONVERSATION_HISTORY_WARN_BYTES` makes the next context-bloat
/// regression visible in logs without needing a user bug report.
pub(super) fn log_history_size(agent_id: &AgentId, msgs: Option<&[ConversationMessage]>) {
    let Some(msgs) = msgs else { return };
    let total_bytes: usize = msgs.iter().map(|m| m.content.len()).sum();
    let count = msgs.len();
    if total_bytes > CONVERSATION_HISTORY_WARN_BYTES {
        warn!(
            %agent_id,
            history_messages = count,
            history_bytes = total_bytes,
            "agent chat: conversation history is large — possible context bloat"
        );
    } else {
        info!(
            %agent_id,
            history_messages = count,
            history_bytes = total_bytes,
            "agent chat: conversation history prepared"
        );
    }
}
