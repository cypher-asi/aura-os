//! Chat persistence context structs: the per-turn `ChatPersistCtx`,
//! the request-shape inputs shared across persistence setup helpers,
//! and the resolver dependency bundle.

use std::sync::Arc;

use aura_os_core::SessionId;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;

#[derive(Clone)]
pub(crate) struct ChatPersistCtx {
    pub(crate) storage: Arc<StorageClient>,
    pub(crate) jwt: String,
    /// Resolved storage session id this chat turn is being persisted
    /// into. Strongly typed as [`SessionId`] in memory; the
    /// `aura_os_storage` JSON layer still wants `String`, so callers
    /// stringify at the boundary (see e.g.
    /// [`super::persist_user_message`] /
    /// [`super::super::persist_task::persist_event`]).
    pub(crate) session_id: SessionId,
    pub(crate) project_agent_id: String,
    pub(crate) project_id: String,
    /// Org-level agent id (the `agents.agent_id` from aura-network)
    /// this persistence context belongs to. Distinct from
    /// `project_agent_id` (the project binding). We broadcast it in
    /// `user_message` / `assistant_message_end` so the UI can key
    /// standalone-chat history entries by the same id the sidebar
    /// uses (`agentHistoryKey(agent_id)`); without it cross-agent
    /// `send_to_agent` deliveries only refresh the sender's view and
    /// the recipient's chat window stays stale until the user hits F5.
    pub(crate) agent_id: Option<String>,
    /// Set by `send_to_agent` in aura-harness when agent A messages
    /// agent B (sourced from
    /// [`crate::dto::SendChatRequest::originating_agent_id`]). Phase 3
    /// of the cross-agent reply plan reads this from `persist_task`
    /// on `AssistantMessageEnd` and posts B's reply back into A's
    /// session as a follow-up `user_message`, so the sender's chat
    /// surfaces the response without a manual refresh. Cross-repo
    /// contract documented in
    /// `c:\code\aura-harness\crates\aura-runtime\src\session\cross_agent_hook.rs::deliver_message`.
    pub(crate) originating_agent_id: Option<String>,
    /// Cross-agent reply chain depth. Sourced from the inbound
    /// `X-Aura-Cross-Agent-Depth` header (Phase 3) by the chat route
    /// handlers and threaded onto the persist ctx so
    /// [`super::super::cross_agent_reply::spawn_cross_agent_reply_callback`]
    /// can short-circuit once the chain hits
    /// [`super::super::cross_agent_reply::MAX_CROSS_AGENT_REPLY_DEPTH`].
    /// Each server-issued reply POST stamps `depth + 1` on the outbound
    /// header so the receiving turn sees the incremented value on its
    /// `ChatPersistCtx`. Defaults to `0` when the header is missing
    /// (legacy harness, direct user chat, etc.) — see
    /// [`super::super::cross_agent_reply::read_cross_agent_depth`] for
    /// the parsing rules.
    pub(crate) cross_agent_depth: u32,
    /// Org-level `agents.agent_id` UUID of the *agent* that injected
    /// this turn on behalf of cross-agent communication, when the
    /// inbound `SendChatRequest` carried `from_agent_id`. Sourced
    /// from [`crate::dto::SendChatRequest::from_agent_id`] in
    /// [`super::super::setup`] and read by
    /// [`super::persist_user_message`] /
    /// [`super::user_message::build_user_message_payload`] so the
    /// persisted `user_message` content carries the provenance, plus
    /// by [`super::super::event_bus::publish_chat_event`] so the WS
    /// event the chat panel listens to also carries it. The chat-row
    /// renderer keys on this to badge cross-agent messages
    /// "↩ from <agent_name>" instead of styling them
    /// indistinguishably from a real human prompt — without this
    /// field, the originating agent's UI silently re-renders
    /// Barret's reply as a duplicate user message above the real
    /// prompt. Distinct from `originating_agent_id`, which exists
    /// for routing the next async reply back; `from_agent_id`
    /// exists for display-side provenance.
    pub(crate) from_agent_id: Option<String>,
}

/// Request-shape inputs shared by the chat persistence setup helpers
/// (`setup_project_chat_persistence`, `setup_agent_chat_persistence`,
/// `setup_agent_chat_persistence_with_matched`,
/// `agent_route::load_persistence_only`) and by the underlying
/// [`super::resolve_chat_session_with_pin`]. Bundles the per-turn
/// flags (force_new, pinned session) with the cross-agent reply
/// chain metadata so each helper signature stays inside the
/// 5-parameter budget and the cross-agent fields can no longer drift
/// out of lockstep at one call site.
///
/// Mirrors the existing `OpenChatStreamArgs` pattern in
/// `streaming.rs`: borrowed fields throughout so the caller can
/// construct it once at the top of a route handler and pass `&req`
/// down without cloning the optional ids until the persist helper
/// materialises a [`ChatPersistCtx`].
pub(crate) struct ChatPersistRequest<'a> {
    pub(crate) jwt: &'a str,
    pub(crate) force_new: bool,
    pub(crate) pinned_session_id: Option<&'a SessionId>,
    /// Phase 2/3 cross-agent reply chain: set by `send_to_agent` in
    /// the harness when agent A messages agent B; threaded onto
    /// [`ChatPersistCtx::originating_agent_id`] so the
    /// `AssistantMessageEnd` callback posts B's reply back into A's
    /// session.
    pub(crate) originating_agent_id: Option<&'a str>,
    /// Cross-agent reply chain depth (Phase 3 cycle guard). Sourced
    /// from the inbound `X-Aura-Cross-Agent-Depth` header by the
    /// route handlers; defaults to 0 for direct user chats.
    pub(crate) cross_agent_depth: u32,
    /// Display-side cross-agent provenance: when this turn was
    /// injected by another agent, the inbound `from_agent_id` is the
    /// sending agent's UUID. Threaded onto the persist ctx so the
    /// chat-row renderer can label the bubble "from <agent>".
    pub(crate) from_agent_id: Option<&'a str>,
}

/// State-derived dependencies shared by
/// [`super::resolve_chat_session_with_pin`] and
/// [`super::super::setup::setup_agent_chat_persistence_with_matched`].
/// Both pull `session_service` + `chat_auto_fork_threshold` off
/// `AppState` at the call site; bundling them keeps the resolver /
/// matched helper signatures inside the 5-parameter budget.
pub(crate) struct ChatSessionResolveDeps<'a> {
    pub(crate) session_service: &'a SessionService,
    pub(crate) auto_fork_threshold: f64,
}
