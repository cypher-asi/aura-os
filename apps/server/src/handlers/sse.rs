use axum::response::sse::Event;

use aura_os_link::AutomatonEvent;

/// Maps an [`AutomatonEvent`] from the swarm to an SSE [`Event`].
pub fn automaton_event_to_sse(evt: &AutomatonEvent) -> Result<Event, serde_json::Error> {
    Event::default()
        .event(&evt.event_type)
        .json_data(&evt.data)
}
