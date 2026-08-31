mod aside;
pub(crate) mod chat;
pub(crate) mod context_contents;
pub(crate) mod context_usage;
mod control;
mod conversions;
mod crud;
mod home_project;
mod installed_tools;
mod instances;
mod marketplace_fields;
mod recall;
mod runtime;
mod safe_workspace;
mod self_improvement;
pub(crate) mod session_identity;
pub(crate) mod session_titles;
pub(crate) mod sessions;
pub(crate) mod subagents;
#[allow(dead_code)]
mod task_context;
pub(crate) mod tool_dedupe;
pub(crate) mod workspace_tools;

pub(crate) use aside::{ask_agent_session_aside, ask_instance_session_aside};
pub(crate) use chat::{
    cancel_agent_turn, cancel_instance_turn, import_public_chat_session, list_agent_events,
    list_agent_events_paginated, list_agent_session_events, list_agent_session_events_paginated,
    list_events, list_session_events_paginated, reset_agent_session, reset_instance_session,
    send_agent_event_stream, send_event_stream,
};
pub(crate) use context_contents::{get_agent_context_contents, get_instance_context_contents};
pub(crate) use context_usage::{get_agent_context_usage, get_instance_context_usage};
pub(crate) use control::{delegate_agent_task, get_agent_state_snapshot};
pub(crate) use crud::create::{
    create_and_provision_remote_agent, prepare_create, provision_existing_agent_as_remote,
};
pub(crate) use crud::{
    clone_agent, create_agent, delete_agent, get_agent, list_agent_project_bindings, list_agents,
    recover_remote_agent_pipeline, remove_agent_project_binding, update_agent,
};
pub(crate) use home_project::ensure_agent_home_project_and_binding;
pub(crate) use installed_tools::get_installed_tools_diagnostic;
pub(crate) use instances::{
    create_agent_instance, delete_agent_instance, get_agent_instance, list_agent_instances,
    update_agent_instance,
};
pub(crate) use recall::search_my_session_history;
pub(crate) use runtime::{session_model_overrides_with_cache, test_agent_runtime};
pub(crate) use safe_workspace::{
    apply_safe_workspace_to_project, get_safe_workspace_checkpoint_diff,
    get_safe_workspace_eligibility, get_safe_workspace_status, restore_safe_workspace_checkpoint,
};
pub(crate) use self_improvement::{
    apply_improvement_proposal, get_self_improvement_config, list_improvement_proposals,
    propose_improvement, reject_improvement_proposal, run_learning_review,
    update_self_improvement_config,
};
pub(crate) use sessions::{
    archive_session, branch_session, delete_session, get_session, list_my_sessions,
    list_project_sessions, list_session_events, list_session_tasks, list_sessions, rename_session,
    restore_archived_session, set_session_pin, set_session_snooze, summarize_session,
};
pub(crate) use subagents::{
    attach_subagent_stream, list_session_subagents, list_subagent_session_events,
    send_subagent_message,
};

pub mod conversions_pub {
    pub(crate) use super::conversions::agent_from_network;
    pub use super::conversions::events_to_session_history;
    pub(crate) use super::conversions::resolve_workspace_path;
}
pub mod chat_pub {
    pub use super::chat::{
        acquire_turn_slot, evaluate_partition_busy, harness_broadcast_to_sse,
        load_current_session_events_for_agent, load_current_session_events_for_instance,
        max_pending_turns, session_events_to_agent_history, session_events_to_conversation_history,
        BusyMatch, BusyScope, TurnSlotAcquired, TurnSlotGuard, TurnSlotQueueFull,
        DEFAULT_MAX_PENDING_TURNS,
    };
}
