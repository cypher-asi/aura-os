//! Bridge: forward [`aura_os_events::DomainEvent`] loop lifecycle and
//! activity events onto the legacy `event_broadcast` firehose as JSON.
//!
//! The existing `/ws/events` WebSocket implementation reads from
//! `AppState::event_broadcast` and streams JSON frames to the frontend.
//! New loop lifecycle events (`LoopOpened`, `LoopActivityChanged`,
//! `LoopEnded`) flow through `EventHub`, which is typed and topic-scoped.
//! This bridge subscribes to the hub (project- and instance-scoped —
//! we use `SubscriptionFilter::empty()` but match every event by using
//! a broad topic union via `Topic::AgentId` for each loop) and rebroadcasts
//! them as JSON so the existing frontend can consume them without a
//! protocol change. Once the frontend migrates to the typed hub over
//! a dedicated endpoint this bridge can be deleted.
//!
//! Invariants:
//! - The bridge must never block the hub. It uses a non-blocking
//!   `broadcast::Sender::send` which drops when no subscribers exist;
//!   that matches the existing behaviour for other producers.
//! - The bridge only emits loop-scoped variants. Other variants are
//!   published directly to both paths at their producer sites.

use aura_os_events::{DomainEvent, EventHub};
use tokio::sync::broadcast;

/// Spawn a task that mirrors loop lifecycle/activity events from `hub`
/// into `broadcast` as JSON. Returns immediately; the background task
/// runs until the hub is dropped.
///
/// Uses [`EventHub::subscribe_all`] because the bridge must observe
/// every loop event regardless of which project / instance it belongs
/// to — it's a trusted in-process consumer, not a UI subscriber.
pub(crate) fn spawn_loop_events_bridge(
    hub: EventHub,
    broadcast: broadcast::Sender<serde_json::Value>,
) {
    let (guard, mut rx) = hub.subscribe_all();
    tokio::spawn(async move {
        // Keep the guard alive for the lifetime of the bridge task so
        // the subscription is unregistered only when the task exits
        // (hub drop or receiver closed). Binding to `_` would drop it
        // immediately.
        let _guard = guard;
        while let Some(event) = rx.recv().await {
            let Some(json) = render_event(&event) else {
                continue;
            };
            let _ = broadcast.send(json);
        }
    });
}

fn render_event(event: &DomainEvent) -> Option<serde_json::Value> {
    match event {
        DomainEvent::LoopOpened(payload) => Some(serde_json::json!({
            "type": "loop_opened",
            "loop_id": payload.loop_id,
            "activity": payload.activity,
            "project_id": payload.loop_id.project_id,
            "agent_instance_id": payload.loop_id.agent_instance_id,
        })),
        DomainEvent::LoopActivityChanged(payload) => Some(serde_json::json!({
            "type": "loop_activity_changed",
            "loop_id": payload.loop_id,
            "activity": payload.activity,
            "project_id": payload.loop_id.project_id,
            "agent_instance_id": payload.loop_id.agent_instance_id,
        })),
        DomainEvent::LoopEnded(payload) => Some(serde_json::json!({
            "type": "loop_ended",
            "loop_id": payload.loop_id,
            "activity": payload.activity,
            "project_id": payload.loop_id.project_id,
            "agent_instance_id": payload.loop_id.agent_instance_id,
        })),
        // Other variants already flow through `event_broadcast` via
        // `emit_domain_event` at their producer sites; re-emitting them
        // here would duplicate WS frames.
        _ => None,
    }
}
