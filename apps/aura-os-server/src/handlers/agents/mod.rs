mod chat;
mod conversions;
mod crud;
mod instances;
mod runtime;
mod sessions;

pub(crate) use chat::{list_agent_events, list_events, send_agent_event_stream, send_event_stream};
pub(crate) use crud::{
    create_agent, delete_agent, get_agent, list_agent_project_bindings, list_agents,
    remove_agent_project_binding, update_agent,
};
pub(crate) use instances::{
    create_agent_instance, delete_agent_instance, get_agent_instance, list_agent_instances,
    update_agent_instance,
};
pub(crate) use runtime::test_agent_runtime;
pub(crate) use sessions::{
    generate_session_summary, get_session, list_project_sessions, list_session_events,
    list_session_tasks, list_sessions, summarize_session,
};

pub mod conversions_pub {
    pub use super::conversions::events_to_session_history;
    pub(crate) use super::conversions::resolve_workspace_path;
}
pub mod chat_pub {
    pub use super::chat::session_events_to_conversation_history;
}
