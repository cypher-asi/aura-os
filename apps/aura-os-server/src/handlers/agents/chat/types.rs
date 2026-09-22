//! Shared SSE response types and header construction.

use std::convert::Infallible;
use std::pin::Pin;

use axum::http::{HeaderMap, HeaderName, HeaderValue};
use axum::response::sse::{Event, Sse};

use super::constants::{
    HEADER_CHAT_ATTACH_ID, HEADER_CHAT_COMMAND_ID, HEADER_CHAT_COMMAND_REPLAYED,
    HEADER_CHAT_PERSISTED, HEADER_CHAT_PROJECT_ID, HEADER_CHAT_SESSION_ID,
};

pub(crate) type SseStream =
    Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send>>;
pub(crate) type SseResponse = (HeaderMap, Sse<SseStream>);

pub(super) fn sse_response_headers(
    persist_snapshot: Option<&(String, String)>,
    client_command_id: Option<&str>,
    replayed: bool,
    attach_id: Option<&str>,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("X-Accel-Buffering", HeaderValue::from_static("no"));
    let persisted = persist_snapshot.is_some();
    headers.insert(
        HeaderName::from_static(HEADER_CHAT_PERSISTED),
        HeaderValue::from_static(if persisted { "true" } else { "false" }),
    );
    if let Some((session_id, project_id)) = persist_snapshot {
        if let Ok(v) = HeaderValue::from_str(session_id) {
            headers.insert(HeaderName::from_static(HEADER_CHAT_SESSION_ID), v);
        }
        if let Ok(v) = HeaderValue::from_str(project_id) {
            headers.insert(HeaderName::from_static(HEADER_CHAT_PROJECT_ID), v);
        }
    }
    if persisted {
        if let Some(command_id) = client_command_id {
            if let Ok(v) = HeaderValue::from_str(command_id) {
                headers.insert(HeaderName::from_static(HEADER_CHAT_COMMAND_ID), v);
            }
        }
    }
    if replayed {
        headers.insert(
            HeaderName::from_static(HEADER_CHAT_COMMAND_REPLAYED),
            HeaderValue::from_static("true"),
        );
    }
    if let Some(attach_id) = attach_id {
        if let Ok(v) = HeaderValue::from_str(attach_id) {
            headers.insert(HeaderName::from_static(HEADER_CHAT_ATTACH_ID), v);
        }
    }
    headers
}

#[cfg(test)]
mod tests {
    use super::sse_response_headers;

    #[test]
    fn accepted_command_receipt_is_correlated_to_persisted_session() {
        let snapshot = ("session-1".to_string(), "project-1".to_string());
        let headers = sse_response_headers(Some(&snapshot), Some("mobile-123"), false, None);

        assert_eq!(headers.get("x-aura-chat-persisted").unwrap(), "true");
        assert_eq!(headers.get("x-aura-chat-session-id").unwrap(), "session-1");
        assert_eq!(headers.get("x-aura-chat-project-id").unwrap(), "project-1");
        assert_eq!(headers.get("x-aura-chat-command-id").unwrap(), "mobile-123");
    }

    #[test]
    fn unpersisted_response_never_claims_a_command_receipt() {
        let headers = sse_response_headers(None, Some("mobile-123"), false, None);

        assert_eq!(headers.get("x-aura-chat-persisted").unwrap(), "false");
        assert!(headers.get("x-aura-chat-command-id").is_none());
    }

    #[test]
    fn replayed_command_exposes_attach_identity() {
        let snapshot = ("session-1".to_string(), "project-1".to_string());
        let headers =
            sse_response_headers(Some(&snapshot), Some("mobile-123"), true, Some("attach-1"));

        assert_eq!(headers.get("x-aura-chat-command-replayed").unwrap(), "true");
        assert_eq!(headers.get("x-aura-attach-id").unwrap(), "attach-1");
    }
}
