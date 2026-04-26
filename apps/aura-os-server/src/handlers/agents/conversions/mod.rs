mod agent;
mod agent_resolve;
mod session_history;
mod workspace_path;

#[cfg(test)]
mod tests;

use aura_os_core::ZeroAuthSession;

pub(crate) use agent::agent_from_network;
pub(crate) use agent_resolve::{resolve_merge_agents_for_ids, resolve_single_agent};
pub use session_history::events_to_session_history;
pub(crate) use workspace_path::resolve_workspace_path;

pub(crate) fn get_user_id(session: &ZeroAuthSession) -> String {
    session.user_id.clone()
}
