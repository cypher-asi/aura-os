use std::convert::Infallible;
use std::pin::Pin;

use axum::http::HeaderValue;
use axum::response::sse::{Event, Sse};

pub(super) type SseStream =
    Pin<Box<dyn futures_core::Stream<Item = Result<Event, Infallible>> + Send>>;
pub(crate) type SseResponse = ([(&'static str, HeaderValue); 1], Sse<SseStream>);

pub(super) const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];
