mod chat;
mod conversions;
mod crud;
pub(crate) mod harness_target;
mod home_project;
mod installed_tools;
mod instances;
mod marketplace_fields;
mod runtime;
mod sessions;
pub(crate) mod tool_dedupe;
pub(crate) mod workspace_tools;

pub(crate) use chat::{
    list_agent_events, list_agent_events_paginated, list_events, reset_agent_session,
    reset_instance_session, send_agent_event_stream, send_event_stream,
};
pub(crate) use crud::{
    create_agent, delete_agent, get_agent, list_agent_project_bindings, list_agents,
    recover_remote_agent_pipeline, remove_agent_project_binding, update_agent,
};
pub(crate) use home_project::ensure_agent_home_project_and_binding;
pub(crate) use installed_tools::get_installed_tools_diagnostic;
pub(crate) use instances::{
    create_agent_instance, delete_agent_instance, get_agent_instance, list_agent_instances,
    update_agent_instance,
};
pub(crate) use runtime::test_agent_runtime;
pub(crate) use sessions::{
    delete_session, generate_session_summary, get_agent_context_usage, get_instance_context_usage,
    get_session, list_project_sessions, list_session_events, list_session_tasks, list_sessions,
    summarize_session,
};

pub mod conversions_pub {
    pub(crate) use super::conversions::agent_from_network;
    pub use super::conversions::events_to_session_history;
    pub(crate) use super::conversions::resolve_workspace_path;
}
pub mod chat_pub {
    pub use super::chat::{
        load_current_session_events_for_agent, load_current_session_events_for_instance,
        session_events_to_agent_history, session_events_to_conversation_history,
    };
}
