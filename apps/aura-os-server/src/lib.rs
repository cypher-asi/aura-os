mod app_builder;
mod auth_guard;
mod billing_bridge;
pub(crate) mod channel_ext;
pub(crate) mod dto;
pub(crate) mod error;
pub mod handlers;
mod network_bridge;
pub(crate) mod orbit_client;
pub(crate) mod persistence;
pub(crate) mod router;
pub(crate) mod state;

pub use app_builder::build_app_state;
pub use router::create_router_with_interface;
pub use state::{AppState, CachedSession};

pub mod handlers_test_support {
    use aura_os_core::SessionEvent;
    use aura_os_link::ConversationMessage;
    use aura_os_storage::StorageSessionEvent;

    pub fn events_to_session_history_pub(
        events: &[StorageSessionEvent],
        project_agent_id: &str,
        project_id: &str,
    ) -> Vec<SessionEvent> {
        crate::handlers::agents::conversions_pub::events_to_session_history(
            events,
            project_agent_id,
            project_id,
        )
    }

    pub fn session_events_to_conversation_history_pub(
        events: &[SessionEvent],
    ) -> Vec<ConversationMessage> {
        crate::handlers::agents::chat_pub::session_events_to_conversation_history(events)
    }

    pub fn build_project_system_prompt_for_test(
        project_id: &str,
        name: &str,
        description: &str,
        agent_prompt: &str,
    ) -> String {
        let mut ctx = format!(
            "<project_context>\nproject_id: {}\nproject_name: {}\n",
            project_id, name,
        );
        if !description.is_empty() {
            ctx.push_str(&format!("description: {}\n", description));
        }
        ctx.push_str("</project_context>\n\n");
        ctx.push_str(
            "IMPORTANT: When calling tools that accept a project_id parameter, \
             always use the project_id from the project_context above.\n\n",
        );
        format!("{}{}", ctx, agent_prompt)
    }
}
