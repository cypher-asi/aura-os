use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use tracing::warn;

#[derive(Debug, Serialize)]
pub(crate) struct ApiError {
    pub error: String,
    pub code: String,
    pub details: Option<String>,
    /// Optional structured error payload for clients that need more than
    /// a free-text `error`/`details`. New error shapes (e.g. the
    /// `chat_persist_failed` / `chat_persist_unavailable` codes the CEO's
    /// `send_to_agent` tool parses) live here so legacy callers that only
    /// read `code` / `error` / `details` continue to work unchanged. The
    /// field is omitted from the JSON body when `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

pub(crate) type ApiResult<T> = Result<T, (StatusCode, Json<ApiError>)>;

impl ApiError {
    pub(crate) fn not_found(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::NOT_FOUND,
            Json(Self {
                error: msg.into(),
                code: "not_found".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn bad_request(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::BAD_REQUEST,
            Json(Self {
                error: msg.into(),
                code: "bad_request".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn internal(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Self {
                error: msg.into(),
                code: "internal_error".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn unauthorized(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::UNAUTHORIZED,
            Json(Self {
                error: msg.into(),
                code: "unauthorized".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn forbidden(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::FORBIDDEN,
            Json(Self {
                error: msg.into(),
                code: "forbidden".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn payment_required(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::PAYMENT_REQUIRED,
            Json(Self {
                error: msg.into(),
                code: "insufficient_credits".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn conflict(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::CONFLICT,
            Json(Self {
                error: msg.into(),
                code: "conflict".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn conflict_with_details(
        msg: impl Into<String>,
        details: impl Into<String>,
    ) -> (StatusCode, Json<Self>) {
        (
            StatusCode::CONFLICT,
            Json(Self {
                error: msg.into(),
                code: "conflict".to_string(),
                details: Some(details.into()),
                data: None,
            }),
        )
    }

    pub(crate) fn service_unavailable(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Self {
                error: msg.into(),
                code: "service_unavailable".to_string(),
                details: None,
                data: None,
            }),
        )
    }

    pub(crate) fn bad_gateway(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::BAD_GATEWAY,
            Json(Self {
                error: msg.into(),
                code: "bad_gateway".to_string(),
                details: None,
                data: None,
            }),
        )
    }
}

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
        let data =
            chat_persist_error_data("chat_persist_failed", &reason, upstream_status, &ctx);
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

/// Extracted context from a nested upstream error body of the form
/// `{"error":{"code":"...","message":"..."}}`.
#[derive(Debug, Default)]
pub(crate) struct UpstreamErrorContext {
    pub upstream_code: Option<String>,
    pub upstream_message: Option<String>,
}

impl UpstreamErrorContext {
    pub(crate) fn parse(body: &str) -> Self {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
            return Self::default();
        };
        let inner = value.get("error");
        let upstream_code = inner
            .and_then(|v| v.get("code"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let upstream_message = inner
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Self {
            upstream_code,
            upstream_message,
        }
    }
}

/// Map a `NetworkError` to an API error response.
///
/// When the upstream body is a nested `{"error":{"code","message"}}` object,
/// the upstream `code` is surfaced in `details` so clients can disambiguate
/// opaque upstream errors (e.g. `DATABASE`) without parsing the body twice.
pub(crate) fn map_network_error(e: aura_os_network::NetworkError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_network::NetworkError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            let ctx = UpstreamErrorContext::parse(body);
            warn!(
                upstream_status = status,
                upstream_code = ?ctx.upstream_code,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-network upstream error"
            );
            let details = ctx
                .upstream_code
                .as_ref()
                .map(|c| format!("upstream_code={c}"));
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "network_error".to_string(),
                    details,
                    data: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-network request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}

/// Map an `IntegrationsError` to an API error response, preserving the upstream HTTP status.
pub(crate) fn map_integrations_error(
    e: aura_os_integrations::IntegrationsError,
) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_integrations::IntegrationsError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            warn!(
                upstream_status = status,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-integrations upstream error"
            );
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "integrations_error".to_string(),
                    details: None,
                    data: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-integrations request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}

/// Map a `StorageError` to an API error response, preserving the upstream HTTP status.
pub(crate) fn map_storage_error(e: aura_os_storage::StorageError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_os_storage::StorageError::Server { status, body } => {
            let code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
            warn!(
                upstream_status = status,
                body_preview = %body.chars().take(200).collect::<String>(),
                "aura-storage upstream error"
            );
            (
                code,
                Json(ApiError {
                    error: body.clone(),
                    code: "storage_error".to_string(),
                    details: None,
                    data: None,
                }),
            )
        }
        _ => {
            warn!(error = %e, "aura-storage request failed");
            ApiError::bad_gateway(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_context_parses_nested_code_and_message() {
        let body = r#"{"error":{"code":"DATABASE","message":"An internal error occurred"}}"#;
        let ctx = UpstreamErrorContext::parse(body);
        assert_eq!(ctx.upstream_code.as_deref(), Some("DATABASE"));
        assert_eq!(
            ctx.upstream_message.as_deref(),
            Some("An internal error occurred")
        );
    }

    #[test]
    fn upstream_context_tolerates_non_json_bodies() {
        let ctx = UpstreamErrorContext::parse("not json");
        assert!(ctx.upstream_code.is_none());
        assert!(ctx.upstream_message.is_none());
    }

    #[test]
    fn upstream_context_tolerates_missing_error_object() {
        let ctx = UpstreamErrorContext::parse(r#"{"other":"value"}"#);
        assert!(ctx.upstream_code.is_none());
        assert!(ctx.upstream_message.is_none());
    }

    #[test]
    fn map_network_error_surfaces_upstream_code_in_details() {
        let err = aura_os_network::NetworkError::Server {
            status: 500,
            body: r#"{"error":{"code":"DATABASE","message":"boom"}}"#.to_string(),
        };
        let (status, Json(api_err)) = map_network_error(err);
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(api_err.code, "network_error");
        assert_eq!(api_err.details.as_deref(), Some("upstream_code=DATABASE"));
    }

    #[test]
    fn map_network_error_leaves_details_empty_when_body_is_opaque() {
        let err = aura_os_network::NetworkError::Server {
            status: 500,
            body: "totally not json".to_string(),
        };
        let (_, Json(api_err)) = map_network_error(err);
        assert!(api_err.details.is_none());
    }

    #[test]
    fn chat_persist_unavailable_returns_424_with_structured_data() {
        let ctx = ChatPersistErrorCtx {
            session_id: None,
            project_id: None,
            project_agent_id: None,
        };
        let (status, Json(api_err)) =
            ApiError::chat_persist_unavailable("no project binding", ctx);
        assert_eq!(status, StatusCode::FAILED_DEPENDENCY);
        assert_eq!(api_err.code, "chat_persist_unavailable");
        let data = api_err.data.expect("data must be populated");
        assert_eq!(data["code"], "chat_persist_unavailable");
        assert_eq!(data["reason"], "no project binding");
        assert!(data["upstream_status"].is_null());
        assert!(data["session_id"].is_null());
        assert!(data["project_id"].is_null());
        assert!(data["project_agent_id"].is_null());
    }

    #[test]
    fn chat_persist_failed_returns_502_with_upstream_status_and_ids() {
        let ctx = ChatPersistErrorCtx {
            session_id: Some("sess-1".into()),
            project_id: Some("proj-1".into()),
            project_agent_id: Some("pa-1".into()),
        };
        let (status, Json(api_err)) =
            ApiError::chat_persist_failed("storage returned 503: upstream down", Some(503), ctx);
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(api_err.code, "chat_persist_failed");
        let data = api_err.data.expect("data must be populated");
        assert_eq!(data["code"], "chat_persist_failed");
        assert_eq!(
            data["reason"],
            serde_json::Value::String("storage returned 503: upstream down".into())
        );
        assert_eq!(data["upstream_status"], 503);
        assert_eq!(data["session_id"], "sess-1");
        assert_eq!(data["project_id"], "proj-1");
        assert_eq!(data["project_agent_id"], "pa-1");
    }

    #[test]
    fn chat_persist_error_body_skips_data_when_none_in_legacy_paths() {
        // Legacy ApiError constructors (not_found, etc.) must still emit
        // bodies without a `data` key so existing clients that assert on
        // the older shape don't break.
        let (_, Json(api_err)) = ApiError::not_found("missing");
        let serialized = serde_json::to_value(&api_err).unwrap();
        assert!(
            serialized.get("data").is_none(),
            "non-chat errors must omit the `data` field entirely, got: {serialized}"
        );
    }

    #[test]
    fn map_chat_persist_storage_error_preserves_upstream_status() {
        let err = aura_os_storage::StorageError::Server {
            status: 503,
            body: r#"{"error":"upstream down"}"#.to_string(),
        };
        let ctx = ChatPersistErrorCtx {
            session_id: Some("sess-2".into()),
            project_id: Some("proj-2".into()),
            project_agent_id: Some("pa-2".into()),
        };
        let (status, Json(api_err)) = map_chat_persist_storage_error(err, ctx);
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(api_err.code, "chat_persist_failed");
        let data = api_err.data.expect("data must be populated");
        assert_eq!(data["upstream_status"], 503);
        let reason = data["reason"].as_str().unwrap();
        assert!(
            reason.starts_with("storage returned 503"),
            "reason should embed upstream status, got: {reason}"
        );
        assert_eq!(data["session_id"], "sess-2");
    }

    #[test]
    fn map_chat_persist_storage_error_non_server_has_no_upstream_status() {
        let err = aura_os_storage::StorageError::NotConfigured;
        let (_, Json(api_err)) =
            map_chat_persist_storage_error(err, ChatPersistErrorCtx::default());
        assert_eq!(api_err.code, "chat_persist_failed");
        let data = api_err.data.expect("data populated");
        assert!(
            data["upstream_status"].is_null(),
            "no upstream HTTP status for non-Server storage errors"
        );
    }
}
