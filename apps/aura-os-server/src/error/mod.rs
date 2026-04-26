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

    /// The upstream harness would reject a new `UserMessage` because
    /// the target agent is already running a turn (typically because
    /// the dev loop / automation started a task on the same agent id
    /// upstream). Returns HTTP 409 with a machine-readable `code`
    /// (`agent_busy`) and a structured `data` payload that frontends
    /// use to render a dedicated "stop automation to chat" affordance
    /// instead of echoing the raw harness string
    /// "A turn is currently in progress; send cancel first".
    pub(crate) fn agent_busy(
        reason: impl Into<String>,
        automaton_id: Option<String>,
    ) -> (StatusCode, Json<Self>) {
        let reason = reason.into();
        let data = serde_json::json!({
            "code": "agent_busy",
            "reason": reason.clone(),
            "automaton_id": automaton_id,
        });
        (
            StatusCode::CONFLICT,
            Json(Self {
                error: reason.clone(),
                code: "agent_busy".to_string(),
                details: Some(reason),
                data: Some(data),
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

mod chat_persist;
mod mappers;
mod upstream;

pub(crate) use chat_persist::{map_chat_persist_storage_error, ChatPersistErrorCtx};
pub(crate) use mappers::{map_integrations_error, map_network_error, map_storage_error};
pub(crate) use upstream::UpstreamErrorContext;

#[cfg(test)]
mod tests;
