use aura_os_core::{AgentId, AgentInstanceId, SessionEvent};
use aura_os_harness::ConversationMessage;
use aura_os_storage::StorageSessionEvent;

use crate::state::AppState;

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

pub fn session_events_to_agent_history_pub(events: &[SessionEvent]) -> Vec<serde_json::Value> {
    crate::handlers::agents::chat_pub::session_events_to_agent_history(events)
}

pub async fn load_current_session_events_for_agent_pub(
    state: &AppState,
    agent_id: &AgentId,
    jwt: &str,
) -> Vec<SessionEvent> {
    crate::handlers::agents::chat_pub::load_current_session_events_for_agent(state, agent_id, jwt)
        .await
}

pub async fn load_current_session_events_for_instance_pub(
    state: &AppState,
    agent_instance_id: &AgentInstanceId,
    jwt: &str,
) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
    crate::handlers::agents::chat_pub::load_current_session_events_for_instance(
        state,
        agent_instance_id,
        jwt,
    )
    .await
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
