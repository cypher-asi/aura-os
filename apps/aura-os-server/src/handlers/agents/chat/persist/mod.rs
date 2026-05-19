//! Chat persistence: context types, session resolution, pinned-session
//! validation, auto-fork detection, and the inbound `user_message` write
//! path. Public surface is re-exported from focused submodules; this file
//! holds only the `build_chat_partition` orchestration helper that the
//! chat routes share with the persist task plumbing.

use aura_os_core::{AgentId, AgentInstanceId};

mod context;
mod fork;
mod pin;
mod resolve;
mod user_message;

pub(crate) use context::{ChatPersistCtx, ChatPersistRequest, ChatSessionResolveDeps};
pub(crate) use fork::ForkInfo;
pub(crate) use pin::{try_pin_session, PinnedSessionOutcome};
pub(crate) use resolve::resolve_chat_session_with_pin;
pub(crate) use user_message::persist_user_message;

/// Build the harness partition string for a chat route, folding in
/// `persist.session_id` as the third segment so the registry, turn
/// slot, and `SessionInit.agent_id` are all per-storage-session. See
/// [`aura_os_core::harness_agent_id`] for the partition shape and
/// `PARALLEL_SESSIONS.md` for why both chat routes share this builder.
///
/// Tier 3 cleanup: `ChatPersistCtx::session_id` is now a typed
/// [`aura_os_core::SessionId`], so the helper no longer parses a
/// `String` back to `SessionId` on every call — the parse happened
/// once at the resolver and the typed value has been carried through
/// to here.
pub(super) fn build_chat_partition(
    template: &AgentId,
    instance: Option<&AgentInstanceId>,
    persist: Option<&ChatPersistCtx>,
) -> String {
    aura_os_core::harness_agent_id(template, instance, persist.map(|c| &c.session_id))
}
