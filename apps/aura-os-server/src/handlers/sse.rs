use std::convert::Infallible;

use axum::response::sse::Event;

use aura_os_link::HarnessOutbound;

/// Maps a [`HarnessOutbound`] event to an SSE [`Event`].
///
/// Event types and field names are passed through as-is from the harness
/// protocol — the interface conforms to the harness wire format.
pub(crate) fn harness_event_to_sse(evt: &HarnessOutbound) -> Result<Event, Infallible> {
    let json = serde_json::to_value(evt).unwrap_or_default();
    let event_type = json
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");
    Ok(Event::default()
        .event(event_type)
        .json_data(&json)
        .unwrap_or_else(|_| Event::default().data("{}")))
}
