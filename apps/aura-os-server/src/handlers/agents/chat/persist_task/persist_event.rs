//! Storage write of a single chat persistence event. Centralised here
//! so every dispatch arm and the synthesized-end fallbacks share the
//! same error-logging shape.

use serde_json::Value;
use tracing::error;

use super::super::persist::ChatPersistCtx;

pub(crate) async fn persist_event(ctx: &ChatPersistCtx, event_type: &str, content: Value) -> bool {
    // Stringify the typed `SessionId` once at this storage-write
    // boundary: `CreateSessionEventRequest.session_id` is the
    // `aura_os_storage` REST shape (still `Option<String>`), and the
    // `create_event` URL segment is `&str`.
    let session_id_str = ctx.session_id.to_string();
    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id_str.clone()),
        user_id: None,
        agent_id: Some(ctx.project_agent_id.clone()),
        sender: Some("agent".to_string()),
        project_id: Some(ctx.project_id.clone()),
        org_id: None,
        event_type: event_type.to_string(),
        content: Some(content),
    };
    match ctx
        .storage
        .create_event(&session_id_str, &ctx.jwt, &req)
        .await
    {
        Ok(_) => true,
        Err(e) => {
            error!(
                error = %e,
                session_id = %ctx.session_id,
                project_agent_id = %ctx.project_agent_id,
                event_type = %event_type,
                "Failed to persist chat event"
            );
            false
        }
    }
}
