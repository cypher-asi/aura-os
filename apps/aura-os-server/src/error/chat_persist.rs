use super::*;

/// Identifiers threaded into `chat_persist_*` errors so the CEO's
/// `send_to_agent` tool (and any other consumer that's trying to land a
/// message in another agent's chat history) can report *which* session
/// could not be written to. All fields are optional because the failure
/// can happen before the project binding / session has been resolved.
#[derive(Debug, Default, Clone)]
pub(crate) struct ChatPersistErrorCtx {
    pub session_id: Option<String>,
    pub project_id: Option<String>,
    pub project_agent_id: Option<String>,
}

/// Build the `data` payload shared by `chat_persist_failed` /
/// `chat_persist_unavailable` responses. Kept in one place so the wire
/// contract (field names, nullability) is enforced on every call site —
/// the `send_to_agent` tool parses this exact shape.
fn chat_persist_error_data(
    code: &str,
    reason: &str,
    upstream_status: Option<u16>,
    ctx: &ChatPersistErrorCtx,
) -> serde_json::Value {
    serde_json::json!({
        "code": code,
        "reason": reason,
        "upstream_status": upstream_status,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
    })
}

impl ApiError {
    /// The agent has no project binding / storage session to persist to
    /// — returned when `persist_ctx` resolves to `None`. The response is
    /// HTTP 424 Failed Dependency: the request was well-formed but a
    /// precondition on a separate resource (storage binding) is not met.
    /// See `send_to_agent` in `exec_tools.rs` for the consumer shape.
    pub(crate) fn chat_persist_unavailable(
        reason: impl Into<String>,
        ctx: ChatPersistErrorCtx,
    ) -> (StatusCode, Json<Self>) {
        let reason = reason.into();
        let data = chat_persist_error_data("chat_persist_unavailable", &reason, None, &ctx);
        (
            StatusCode::FAILED_DEPENDENCY,
            Json(Self {
                error: reason.clone(),
                code: "chat_persist_unavailable".to_string(),
                details: Some(reason),
                data: Some(data),
            }),
        )
    }

    /// Persisting the inbound user message failed. The harness must NOT
    /// receive the user turn, the SSE stream must NOT be opened, and the
    /// caller (typically the CEO's `send_to_agent` tool) must see a hard
    /// failure so it can stop reporting `persisted: true` on writes that
    /// silently vanished from the target agent's chat history.
    pub(crate) fn chat_persist_failed(
        reason: impl Into<String>,
        upstream_status: Option<u16>,
        ctx: ChatPersistErrorCtx,
    ) -> (StatusCode, Json<Self>) {
        let reason = reason.into();
        let data = chat_persist_error_data("chat_persist_failed", &reason, upstream_status, &ctx);
        (
            StatusCode::BAD_GATEWAY,
            Json(Self {
                error: reason.clone(),
                code: "chat_persist_failed".to_string(),
                details: Some(reason),
                data: Some(data),
            }),
        )
    }
}

/// Translate a `StorageError` that occurred while persisting a chat
/// user-message event into the structured `chat_persist_failed` shape.
/// Preserves the upstream HTTP status when present so the CEO tool can
/// distinguish 5xx storage outages from 4xx validation rejections.
pub(crate) fn map_chat_persist_storage_error(
    e: aura_os_storage::StorageError,
    ctx: ChatPersistErrorCtx,
) -> (StatusCode, Json<ApiError>) {
    let upstream_status = match &e {
        aura_os_storage::StorageError::Server { status, .. } => Some(*status),
        _ => None,
    };
    let reason = match &e {
        aura_os_storage::StorageError::Server { status, body } => {
            let preview: String = body.chars().take(400).collect();
            format!("storage returned {status}: {preview}")
        }
        other => other.to_string(),
    };
    ApiError::chat_persist_failed(reason, upstream_status, ctx)
}
