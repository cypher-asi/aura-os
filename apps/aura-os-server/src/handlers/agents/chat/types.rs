//! Shared SSE response types and header construction.

use std::convert::Infallible;
use std::pin::Pin;

use axum::http::{HeaderMap, HeaderName, HeaderValue};
use axum::response::sse::{Event, Sse};

use super::constants::{HEADER_CHAT_PERSISTED, HEADER_CHAT_PROJECT_ID, HEADER_CHAT_SESSION_ID};

pub(crate) type SseStream =
    Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send>>;
pub(crate) type SseResponse = (HeaderMap, Sse<SseStream>);

pub(super) fn sse_response_headers(persist_snapshot: Option<&(String, String)>) -> HeaderMap {
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
    headers
}
