//! WebSocket-event-bus publishers for chat lifecycle events. Consumed
//! by `useChatHistorySync` on the client to live-refresh chat panels
//! when other agents (e.g. the CEO via `send_to_agent`) write into a
//! target agent's history.
//!
//! Phase 4 of the `send_to_agent` cross-agent UX fix funnels both
//! lifecycle publishers (`user_message`, `assistant_message_end`)
//! through the single [`publish_chat_event`] helper. Two parallel
//! `serde_json::json!` builders had drifted apart in the past
//! (different field sets, casing, optional vs required) and the
//! frontend matcher (Phase 5) keys on this exact wire shape, so the
//! drift was a silent UI bug. Tests below pin the canonical 5-key
//! payload.
//!
//! Tracing target across all WS-related logs is **`aura::ws`** —
//! Phase 6 grep this single target (alongside `aura::cross_agent`) to
//! diagnose missing live updates end to end. The full table of log
//! sites and the `RUST_LOG` invocation that turns them on lives in
//! [`CROSS_AGENT_TRACING.md`](./CROSS_AGENT_TRACING.md) — keep that
//! doc in sync when adding or removing log lines under either target.

use serde::Serialize;

use super::persist::ChatPersistCtx;

/// Canonical wire shape for chat lifecycle events on the WS bus.
///
/// Both `publish_user_message_event` and
/// `publish_assistant_message_end_event` produce **exactly** these
/// keys; the structural-equality regression test in this module
/// flags any future divergence between the two publishers. The
/// frontend matcher (Phase 5) and the live-refresh hook
/// (`useChatHistorySync`) both key on this shape, so adding or
/// renaming a field here is a cross-repo wire change.
///
/// The three id fields are `Option<&str>` deliberately: callers may
/// not have every id (e.g. project-scoped sessions have no org-level
/// `agent_id`). Serde is configured **without**
/// `skip_serializing_if` so a `None` lands as JSON `null` rather
/// than being elided — the UI matcher checks for the key's presence
/// before reading its value, and an elided key would look the same
/// as an unrelated event type.
///
/// `from_agent_id` is optional and elided with `skip_serializing_if`
/// because, unlike the routing keys above, it only appears on
/// cross-agent injected `user_message` rows (A→B inbound or B→A
/// reply callback). Keeping the regular-prompt wire shape unchanged
/// means existing UI matchers don't need to learn the new field
/// just to keep working.
#[derive(Serialize)]
struct ChatEventPayload<'a> {
    #[serde(rename = "type")]
    event_type: &'a str,
    session_id: &'a str,
    project_id: Option<&'a str>,
    project_agent_id: Option<&'a str>,
    agent_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from_agent_id: Option<&'a str>,
}

/// Build the canonical chat-event JSON payload as a
/// `serde_json::Value`. Module-private so the unit tests can pin the
/// null-serialization behavior without going through the broadcaster
/// (the in-scope `ChatPersistCtx` carries `String` for
/// `project_id`/`project_agent_id`, so the all-`None` case is only
/// reachable via this constructor).
fn build_chat_event_payload(
    event_type: &str,
    session_id: &str,
    project_id: Option<&str>,
    project_agent_id: Option<&str>,
    agent_id: Option<&str>,
    from_agent_id: Option<&str>,
) -> serde_json::Value {
    let payload = ChatEventPayload {
        event_type,
        session_id,
        project_id,
        project_agent_id,
        agent_id,
        from_agent_id,
    };
    // `to_value` on a derived-`Serialize` struct of `&str` /
    // `Option<&str>` cannot fail, but we still avoid `.expect(...)`
    // here so the WS publish path is structurally panic-free even
    // if a future field swap introduces a fallible serializer.
    serde_json::to_value(&payload).unwrap_or(serde_json::Value::Null)
}

/// One-true-publisher for the canonical chat lifecycle events.
/// Both public publishers below delegate here so the wire shape and
/// tracing target stay locked together — there is no second JSON
/// builder that could silently drift.
///
/// Failure modes:
/// - `Err(SendError(_))` from `broadcast::Sender::send` only happens
///   when there are zero live receivers. That is the normal state
///   at startup before the WS endpoint has been hit, so we log at
///   `debug!` (not `warn!`) to keep the steady-state logs clean.
/// - The function never panics and never returns an error to the
///   caller; chat persistence must not be coupled to whether the
///   UI happens to be open.
fn publish_chat_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    event_type: &str,
    ctx: &ChatPersistCtx,
) {
    let project_id = Some(ctx.project_id.as_str());
    let project_agent_id = Some(ctx.project_agent_id.as_str());
    let agent_id = ctx.agent_id.as_deref();
    // Cross-agent provenance: only set on `user_message` rows that
    // were injected by another agent. The frontend chat-history
    // invalidator and renderer treat its presence as "this row got
    // the ↩ from <agent> badge in the persisted history, so the
    // refetch will surface it" — for `assistant_message_end` we
    // currently always pass it through as `None` (assistant rows
    // never carry the badge), but the field is plumbed for
    // future use without a second wire change.
    let from_agent_id = ctx.from_agent_id.as_deref();

    tracing::debug!(
        target: "aura::ws",
        event_type,
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        agent_id = ?ctx.agent_id,
        from_agent_id = ?ctx.from_agent_id,
        "publishing chat event"
    );

    // Stringify the typed `SessionId` at this wire-payload boundary
    // (`build_chat_event_payload` keeps `&str` to match the WS JSON
    // contract — `session_id` is a raw UUID string on the frontend).
    let session_id_str = ctx.session_id.to_string();
    let payload = build_chat_event_payload(
        event_type,
        &session_id_str,
        project_id,
        project_agent_id,
        agent_id,
        from_agent_id,
    );

    match bus.send(payload) {
        Ok(n) => tracing::trace!(
            target: "aura::ws",
            event_type,
            subscribers = n,
            "ws event published"
        ),
        Err(_) => tracing::debug!(
            target: "aura::ws",
            event_type,
            "no ws subscribers; event dropped"
        ),
    }
}

/// Publish a `user_message` event on the app-wide WebSocket event bus.
/// The UI's `useChatHistorySync` hook subscribes to this and force-refetches
/// the target agent's chat history so cross-agent writes (from the CEO's
/// `send_to_agent` tool, say) surface live in the target's panel without
/// needing a manual reload.
///
/// `_event_id` is retained for backwards-compat with existing call
/// sites and for future Phase 6 tracing; it is intentionally not
/// embedded in the wire payload — the canonical shape is shared with
/// `publish_assistant_message_end_event` and per-event ids would
/// break the structural-equality contract the frontend matcher
/// depends on.
pub(crate) fn publish_user_message_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    _event_id: &str,
) {
    publish_chat_event(bus, "user_message", ctx);
}

/// Publish an `assistant_message_end` event on the app-wide WebSocket
/// event bus after a successful persist. Same consumer story as
/// `publish_user_message_event`; emits the same canonical payload
/// shape so the Phase 5 frontend matcher can branch on `type` alone.
pub(crate) fn publish_assistant_message_end_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    _message_id: &str,
) {
    publish_chat_event(bus, "assistant_message_end", ctx);
}

/// Publish a `session_summary_updated` event on the WS bus once the
/// on-send title generator (see
/// `crate::handlers::agents::sessions::generate_session_title`) has
/// landed a fresh ChatGPT-style title for a brand-new session. The
/// client's `SessionsList` subscribes via `useEventStore` and patches
/// the matching row so the sidekick label flips from
/// `NEW_CHAT_PLACEHOLDER` ("New chat") to the real title without
/// waiting for `useSessionSummaries` to lazy-fetch on next mount —
/// crucially, this lands while the assistant turn is still streaming.
///
/// `summary` is the new label string; the field is named `summary`
/// (not `title`) to match the storage column name
/// `summary_of_previous_context` and to keep the wire payload
/// symmetric with the persisted shape.
///
/// Phase 4 note: this event carries an extra `summary` payload field
/// and is therefore NOT funneled through `publish_chat_event` — only
/// the two canonical lifecycle events share the locked shape.
pub(crate) fn publish_session_summary_updated_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    summary: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "session_summary_updated",
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        "agent_instance_id": ctx.project_agent_id,
        "agent_id": ctx.agent_id,
        "summary": summary,
    }));
}

/// Publish a heartbeat-style progress event on the WS bus for an
/// in-flight assistant turn. Carries no payload beyond the routing
/// keys so the chat-history-sync hook on the client can throttle
/// itself into a single force-refetch per emission and pull the
/// latest reconstructed partial turn from `events_to_session_history`
/// — rather than us trying to ship token-level deltas over the bus.
///
/// Throttled to at most ~one publish per
/// `ASSISTANT_TURN_PROGRESS_THROTTLE` (currently 400ms) inside
/// `spawn_chat_persist_task`. Final state is delivered by the
/// existing `assistant_message_end` publish, so a missed progress
/// event just means slightly later refresh; correctness is preserved.
pub(super) fn publish_assistant_turn_progress_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "assistant_turn_progress",
        "message_id": message_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        "agent_instance_id": ctx.project_agent_id,
        "agent_id": ctx.agent_id,
    }));
}

#[cfg(test)]
mod tests {
    //! Phase 4 regression tests pin the canonical wire shape for
    //! `user_message` and `assistant_message_end`. These payloads
    //! cross a process boundary (server → WS → frontend matcher) and
    //! the matcher (Phase 5) keys on the exact field set, so any
    //! drift here is a silent UI bug. The structural-equality test
    //! is the load-bearing one: it catches a publisher gaining a
    //! field the other doesn't.
    //!
    //! We use a plain `tokio::sync::broadcast::channel::<Value>(64)`
    //! directly (the live `AppState.event_broadcast` carries
    //! `serde_json::Value`, not `String`, so the test channel matches
    //! that type) — no axum / AppState scaffolding required.
    use std::sync::Arc;

    use tokio::sync::broadcast;

    use super::*;

    /// Minimal `ChatPersistCtx` literal for the tests. Mirrors the
    /// shape used by `cross_agent_reply::tests::ctx_with_originator`
    /// but parameterized on the three id fields the wire payload
    /// surfaces. `session_id` is taken as `SessionId` directly now
    /// that `ChatPersistCtx.session_id` is typed; the wire payload
    /// the publisher emits still stringifies through `Display`.
    fn test_ctx(
        session_id: aura_os_core::SessionId,
        project_id: &str,
        project_agent_id: &str,
        agent_id: Option<&str>,
    ) -> ChatPersistCtx {
        ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://localhost:9999",
            )),
            jwt: "jwt".to_string(),
            session_id,
            project_agent_id: project_agent_id.to_string(),
            project_id: project_id.to_string(),
            agent_id: agent_id.map(str::to_string),
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        }
    }

    /// Pin the canonical wire shape for `user_message`. The Phase 5
    /// frontend matcher keys on this exact field set; gaining a key
    /// here ships a wire-shape change to the UI.
    #[tokio::test]
    async fn user_message_event_payload_shape_is_pinned() {
        let (tx, mut rx) = broadcast::channel::<serde_json::Value>(64);
        let session_id = aura_os_core::SessionId::new();
        let ctx = test_ctx(session_id, "project-x", "instance-y", Some("agent-z"));

        publish_user_message_event(&tx, &ctx, "evt-1");

        let value = rx
            .try_recv()
            .expect("publish must enqueue exactly one event");
        let obj = value.as_object().expect("payload must be a JSON object");

        assert_eq!(
            obj.get("type").and_then(|v| v.as_str()),
            Some("user_message"),
            "type field must be 'user_message'"
        );
        assert_eq!(
            obj.get("session_id").and_then(|v| v.as_str()),
            Some(session_id.to_string().as_str())
        );
        assert_eq!(
            obj.get("project_id").and_then(|v| v.as_str()),
            Some("project-x")
        );
        assert_eq!(
            obj.get("project_agent_id").and_then(|v| v.as_str()),
            Some("instance-y")
        );
        assert_eq!(
            obj.get("agent_id").and_then(|v| v.as_str()),
            Some("agent-z")
        );
        assert_eq!(
            obj.len(),
            5,
            "canonical chat-event payload must have exactly five keys when \
             from_agent_id is absent (skip_serializing_if elides it); got: {:?}",
            obj.keys().collect::<Vec<_>>()
        );
        // Phase 2 server-side bookkeeping must not leak onto the wire.
        assert!(
            !obj.contains_key("originating_agent_id"),
            "originating_agent_id is server bookkeeping and must not appear on the wire"
        );
        assert!(
            !obj.contains_key("cross_agent_depth"),
            "cross_agent_depth is server bookkeeping and must not appear on the wire"
        );
        assert!(
            !obj.contains_key("from_agent_id"),
            "from_agent_id must be elided on regular user prompts so the wire shape \
             matches the historical 5-key payload existing matchers expect"
        );
    }

    /// Cross-agent provenance pin: when the persist ctx carries a
    /// `from_agent_id` (set by `setup.rs` from the inbound
    /// `SendChatRequest::from_agent_id`), the canonical wire
    /// payload MUST include the field as a string. Pairs with
    /// `parse_user_message_event` reading the same field out of
    /// the persisted content payload — both sides go through this
    /// publisher when the chat panel hits a fresh refetch.
    #[tokio::test]
    async fn user_message_event_payload_includes_from_agent_id_when_set() {
        let (tx, mut rx) = broadcast::channel::<serde_json::Value>(64);
        let mut ctx = test_ctx(
            aura_os_core::SessionId::new(),
            "project-x",
            "instance-y",
            Some("agent-z"),
        );
        ctx.from_agent_id = Some("barret-uuid".to_string());

        publish_user_message_event(&tx, &ctx, "evt-2");

        let value = rx.try_recv().expect("publish must enqueue exactly one event");
        let obj = value.as_object().expect("payload must be a JSON object");
        assert_eq!(
            obj.get("from_agent_id").and_then(|v| v.as_str()),
            Some("barret-uuid"),
            "from_agent_id must round-trip onto the WS event so any future \
             inline-render path can pick it up without a fetch"
        );
        assert_eq!(
            obj.len(),
            6,
            "with from_agent_id set, canonical payload gains exactly one key (=6); got: {:?}",
            obj.keys().collect::<Vec<_>>()
        );
    }

    /// Pin the JSON-null behavior for missing id fields. The matcher
    /// expects keys to always be present (even as `null`), so
    /// `Option::None` must serialize as `null`, never be elided. We
    /// drive this through `build_chat_event_payload` directly
    /// because `ChatPersistCtx::project_id` /
    /// `project_agent_id` are non-`Option` strings — the all-`None`
    /// path is only reachable via the typed-payload constructor.
    #[test]
    fn user_message_event_payload_serializes_missing_ids_as_null() {
        let value = build_chat_event_payload("user_message", "sess-1", None, None, None, None);
        let obj = value.as_object().expect("payload must be a JSON object");

        // Keys present...
        assert!(
            obj.contains_key("project_id"),
            "project_id must always be present"
        );
        assert!(
            obj.contains_key("project_agent_id"),
            "project_agent_id must always be present"
        );
        assert!(
            obj.contains_key("agent_id"),
            "agent_id must always be present"
        );

        // ...with explicit JSON null values.
        assert_eq!(obj["project_id"], serde_json::Value::Null);
        assert_eq!(obj["project_agent_id"], serde_json::Value::Null);
        assert_eq!(obj["agent_id"], serde_json::Value::Null);

        // The non-id fields are still well-formed.
        assert_eq!(
            obj["type"],
            serde_json::Value::String("user_message".into())
        );
        assert_eq!(
            obj["session_id"],
            serde_json::Value::String("sess-1".into())
        );
        assert_eq!(obj.len(), 5);
    }

    /// Structural-drift guard: the two canonical publishers must
    /// emit payloads with the exact same field set, differing only
    /// in `type`. If a future change adds a key to one publisher and
    /// not the other, this test fails loudly — which is the whole
    /// point of the Phase 4 refactor (one helper, one shape).
    #[tokio::test]
    async fn assistant_message_end_event_shape_matches_user_message_shape() {
        let (tx, mut rx) = broadcast::channel::<serde_json::Value>(64);
        let ctx = test_ctx(
            aura_os_core::SessionId::new(),
            "project-x",
            "instance-y",
            Some("agent-z"),
        );

        publish_user_message_event(&tx, &ctx, "evt-1");
        publish_assistant_message_end_event(&tx, &ctx, "msg-1");

        let user_msg = rx.try_recv().expect("user_message must enqueue");
        let asst_end = rx.try_recv().expect("assistant_message_end must enqueue");

        let mut user_obj = user_msg
            .as_object()
            .cloned()
            .expect("user_message payload must be a JSON object");
        let mut asst_obj = asst_end
            .as_object()
            .cloned()
            .expect("assistant_message_end payload must be a JSON object");

        // Lift out the `type` discriminator so the rest of the
        // structural comparison can be a single equality check.
        let user_type = user_obj
            .remove("type")
            .and_then(|v| v.as_str().map(String::from));
        let asst_type = asst_obj
            .remove("type")
            .and_then(|v| v.as_str().map(String::from));
        assert_eq!(user_type.as_deref(), Some("user_message"));
        assert_eq!(asst_type.as_deref(), Some("assistant_message_end"));

        assert_eq!(
            user_obj, asst_obj,
            "publishers must emit identical fields apart from `type`; this is the Phase 4 drift guard"
        );
    }

    /// Sanity: dropping every receiver before publishing must not
    /// panic. `broadcast::Sender::send` returns
    /// `Err(SendError(_))` when there are no live receivers — the
    /// normal state at startup before the WS endpoint has been
    /// hit — and our publishers swallow it. If this regresses, the
    /// chat hot path would start panicking whenever a turn lands
    /// before any WS client has connected.
    #[tokio::test]
    async fn publish_with_no_subscribers_does_not_panic() {
        let (tx, rx) = broadcast::channel::<serde_json::Value>(64);
        drop(rx);

        let ctx = test_ctx(
            aura_os_core::SessionId::new(),
            "project-x",
            "instance-y",
            Some("agent-z"),
        );
        publish_user_message_event(&tx, &ctx, "evt-1");
        publish_assistant_message_end_event(&tx, &ctx, "msg-1");
        // Reaching this line proves both publishers ran to
        // completion without unwinding; no further assertion needed.
    }
}
