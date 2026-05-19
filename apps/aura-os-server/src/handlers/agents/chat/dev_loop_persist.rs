//! Dev-loop persistence task — subscribes a dev-loop harness JSON
//! broadcast to the same per-event persistence machinery the chat
//! agent uses, so every dev-loop harness event lands as a
//! `SessionEvent` row. Any future replay through
//! [`super::compaction::session_events_to_agent_history`] then goes
//! through the same dangling-`tool_use` strip, recent-window cap,
//! tool-blob truncation, and (post-G0a) parallel-`tool_result`
//! dedupe that chat already enjoys.
//!
//! This is the "Phase G0b" half of plan F1: the dev-loop forwarder
//! spawns this task alongside its existing side-effects worker (see
//! `apps/aura-os-server/src/handlers/dev_loop/streaming/mod.rs`). Both
//! consumers see every harness event; neither blocks the other. The
//! existing `loop_log` writer, `LoopHandle` progress updates, and
//! task-output cache writes are unchanged — this subscription is
//! purely additive.
//!
//! Differences from [`super::persist_task::spawn_chat_persist_task`]:
//!
//! * **Multi-turn safe.** A chat session is one user message → one
//!   assistant turn → one `AssistantMessageEnd`; the chat task
//!   breaks out of its loop on the terminal event. A dev-loop
//!   harness session spans many tasks and many assistant turns, so
//!   this task keeps draining the broadcast past
//!   `AssistantMessageEnd` / `Error`. Per-turn accumulators on the
//!   shared [`PersistTaskState`] are reset between turns so the
//!   next turn does not inherit the previous turn's `full_text` /
//!   `content_blocks`.
//! * **No chat-specific UI side effects.** Cross-agent reply
//!   delivery, auto-fork marker, stability metrics, and the chat
//!   WS event bus are all bypassed — they would misroute on a
//!   dev-loop session that has no chat panel attached. The chat
//!   dispatcher still tries to publish onto a broadcast sender we
//!   hand it; we pass a sender whose receiver is dropped at
//!   construction so every publish lands as a silent
//!   `Err(SendError)` instead of leaking onto
//!   `AppState::event_broadcast`.
//! * **Input is JSON, not `HarnessOutbound`.** The dev-loop's
//!   broadcast carries the raw harness WS payload as
//!   `serde_json::Value`. Each event is best-effort deserialized to
//!   the typed `HarnessOutbound` before dispatch; events that
//!   aren't `HarnessOutbound` variants (dev-loop-only lifecycle
//!   types like `task_started` / `task_failed` / `loop_finished`)
//!   are silently skipped here — those are already persisted /
//!   handled by the dev-loop's existing side-effects worker.
//!
//! See plan section G.0a for the architectural constraint:
//! `dedupe_tool_results_by_id`, `session_events_to_agent_history`,
//! and `persist_event` all stay in `agents::chat`. The dev-loop
//! reaches them through this thin subscriber, not by re-implementing
//! them in a parallel module.

use aura_os_harness::HarnessOutbound;
use serde_json::Value;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use super::persist::ChatPersistCtx;
use super::persist_task::PersistTaskState;
use super::persist_task_dispatch::handle_outbound;

/// Spawn a background task that persists every harness event the
/// dev-loop forwarder receives. The persist task is a second
/// consumer of the dev-loop's harness broadcast (the first being the
/// existing side-effects worker that drives `LoopHandle`, task
/// output cache, and `task_*` lifecycle bookkeeping). Both
/// consumers see every event; neither blocks the other.
///
/// Returns the spawned task's [`JoinHandle`]. Production callers
/// (the dev-loop forwarder) `.abort_handle()` it for parity with
/// `spawn_event_forwarder`'s lifetime model; tests `.await` it
/// after dropping the broadcast sender to drive the persist loop
/// to completion deterministically.
pub(crate) fn spawn_dev_loop_persist_task(
    rx: broadcast::Receiver<Value>,
    ctx: ChatPersistCtx,
) -> JoinHandle<()> {
    tokio::spawn(run_dev_loop_persist_loop(rx, ctx))
}

async fn run_dev_loop_persist_loop(mut rx: broadcast::Receiver<Value>, ctx: ChatPersistCtx) {
    // Local, immediately-orphaned event bus. `handle_outbound`
    // publishes chat-shaped WS events on its terminal arms; we hand
    // it this sink so those publishes drop silently instead of
    // landing on the real `state.event_broadcast` (where chat-only
    // UI subscribers would treat them as live chat traffic). Capacity
    // is irrelevant because no receiver lives long enough to read.
    let (event_bus, _) = broadcast::channel::<Value>(1);
    let mut state = PersistTaskState::new();
    loop {
        match rx.recv().await {
            Ok(evt) => handle_event(&mut state, &ctx, &event_bus, evt).await,
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                warn!(
                    session_id = %ctx.session_id,
                    project_agent_id = %ctx.project_agent_id,
                    skipped,
                    "dev-loop persist receiver lagged; continuing to drain so subsequent events still land"
                );
                continue;
            }
        }
    }
}

async fn handle_event(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    evt: Value,
) {
    state.seq += 1;
    let Some(typed) = deserialize_outbound(&evt, ctx) else {
        return;
    };
    let _produced_progress = handle_outbound(state, ctx, event_bus, &typed, None).await;
    if is_terminal_turn_event(&typed) {
        reset_per_turn_state(state);
    }
}

/// Best-effort `serde_json::Value` → [`HarnessOutbound`] conversion.
///
/// Dev-loop broadcasts carry assistant-turn events (which deserialize
/// cleanly) **and** dev-loop-only lifecycle events such as
/// `task_started`, `task_failed`, `loop_started`, `loop_finished`.
/// The latter aren't `HarnessOutbound` variants; they are handled
/// elsewhere in the dev-loop side-effects worker. Returning `None`
/// is the silent-skip path for those.
fn deserialize_outbound(evt: &Value, ctx: &ChatPersistCtx) -> Option<HarnessOutbound> {
    match serde_json::from_value::<HarnessOutbound>(evt.clone()) {
        Ok(typed) => Some(typed),
        Err(error) => {
            debug!(
                session_id = %ctx.session_id,
                %error,
                event_type = ?evt.get("type").and_then(|v| v.as_str()),
                "dev-loop persist: event is not a HarnessOutbound; skipping (dev-loop lifecycle event)"
            );
            None
        }
    }
}

fn is_terminal_turn_event(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
    )
}

/// Drop per-turn accumulators (text, content blocks, message id,
/// pairing bookkeeping) at the end of every assistant turn so the
/// next turn's events do not inherit content from the previous one.
/// Preserves [`PersistTaskState::seq`] so event ordering across the
/// whole dev-loop session stays monotonic.
fn reset_per_turn_state(state: &mut PersistTaskState) {
    let preserved_seq = state.seq;
    *state = PersistTaskState::new();
    state.seq = preserved_seq;
}

#[cfg(test)]
mod tests {
    //! G0b smoke test: drive a tool_use_start → tool_result sequence
    //! through the dev-loop persist task and assert the persisted
    //! events round-trip through `events_to_session_history` and
    //! `session_events_to_agent_history` into a valid Anthropic
    //! message array.
    //!
    //! Deeper compaction coverage (dangling-tool_use strip,
    //! recent-window cap, parallel-tool-result dedupe) lives in
    //! `chat::tests::compaction_tests` (G0a). This test pins the
    //! persistence half of the pipeline: dev-loop broadcast →
    //! `SessionEvent` rows that the compaction module can read.
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::broadcast;

    use aura_os_core::{ProjectId, SessionId};
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{CreateSessionRequest, StorageClient};

    use super::super::compaction::session_events_to_agent_history;
    use super::super::persist::ChatPersistCtx;
    use super::spawn_dev_loop_persist_task;
    use crate::handlers::agents::conversions::events_to_session_history;

    const PROJECT_AGENT_ID: &str = "00000000-0000-0000-0000-000000000aaa";
    const PROJECT_ID_STR: &str = "00000000-0000-0000-0000-000000000bbb";

    async fn setup_ctx() -> (Arc<StorageClient>, ChatPersistCtx, SessionId, ProjectId) {
        let (url, _db) = start_mock_storage().await;
        // Leak the mock-DB handle so the in-memory state outlives this
        // setup helper; the server task holds the data alive for the
        // process and the test never tears it down.
        std::mem::forget(_db);
        let storage = Arc::new(StorageClient::with_base_url(&url));
        let project_id: ProjectId = PROJECT_ID_STR
            .parse()
            .expect("static UUID literal must parse as ProjectId");
        let session = storage
            .create_session(
                PROJECT_AGENT_ID,
                "jwt",
                &CreateSessionRequest {
                    project_id: project_id.to_string(),
                    org_id: None,
                    model: None,
                    status: Some("active".to_string()),
                    context_usage_estimate: None,
                    summary_of_previous_context: None,
                },
            )
            .await
            .expect("mock storage create_session");
        let session_id: SessionId = session
            .id
            .parse()
            .expect("mock storage must return a parseable UUID");
        let ctx = ChatPersistCtx {
            storage: Arc::clone(&storage),
            jwt: "jwt".to_string(),
            session_id,
            project_id: project_id.to_string(),
            project_agent_id: PROJECT_AGENT_ID.to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        };
        (storage, ctx, session_id, project_id)
    }

    #[tokio::test]
    async fn tool_use_then_tool_result_round_trips_through_compaction() {
        let (storage, ctx, session_id, project_id) = setup_ctx().await;
        let (tx, rx) = broadcast::channel::<serde_json::Value>(32);
        let handle = spawn_dev_loop_persist_task(rx, ctx);

        // Synthesize the minimum sequence the chat dispatcher needs
        // to lay down a complete assistant turn:
        //   1. assistant_message_start so the persisted rows carry
        //      a message id.
        //   2. tool_use_start to seed the pending tool_use block.
        //   3. tool_result paired by wire `tool_use_id` (post-G0a
        //      shape).
        //   4. assistant_message_end with the snapshotted
        //      content_blocks so `events_to_session_history` can
        //      reconstruct the full turn.
        let tool_use_id = "toolu_g0b_smoke_test";
        tx.send(serde_json::json!({
            "type": "assistant_message_start",
            "message_id": "msg-1",
        }))
        .expect("send assistant_message_start");
        tx.send(serde_json::json!({
            "type": "tool_use_start",
            "id": tool_use_id,
            "name": "read_file",
        }))
        .expect("send tool_use_start");
        tx.send(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "name": "read_file",
            "result": "ok",
            "is_error": false,
        }))
        .expect("send tool_result");
        tx.send(serde_json::json!({
            "type": "assistant_message_end",
            "message_id": "msg-1",
            "stop_reason": "stop",
            // SessionUsage requires every counter field to be present
            // (no `#[serde(default)]`); mirror what the harness emits
            // for a no-cost synthesised turn.
            "usage": {
                "input_tokens": 0,
                "output_tokens": 0,
                "estimated_context_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
                "cumulative_input_tokens": 0,
                "cumulative_output_tokens": 0,
                "cumulative_cache_creation_input_tokens": 0,
                "cumulative_cache_read_input_tokens": 0,
                "context_utilization": 0.0,
                "model": "",
                "provider": "",
            },
            "files_changed": { "created": [], "modified": [], "deleted": [] },
        }))
        .expect("send assistant_message_end");
        drop(tx);

        tokio::time::timeout(Duration::from_secs(5), handle)
            .await
            .expect("dev-loop persist task did not finish in 5s")
            .expect("dev-loop persist task panicked");

        // Reach into mock storage directly to inspect what landed.
        // We expect at minimum one `tool_use_start`, one `tool_result`
        // tagged with the wire id, and one `assistant_message_end` row.
        let raw_events = storage
            .list_events(&session_id.to_string(), "jwt", None, None)
            .await
            .expect("list_events from mock storage");
        let event_types: Vec<&str> = raw_events
            .iter()
            .filter_map(|e| e.event_type.as_deref())
            .collect();
        assert!(
            event_types.contains(&"tool_use_start"),
            "tool_use_start must be persisted, saw: {event_types:?}",
        );
        assert!(
            event_types.contains(&"tool_result"),
            "tool_result must be persisted, saw: {event_types:?}",
        );
        assert!(
            event_types.contains(&"assistant_message_end"),
            "assistant_message_end must be persisted, saw: {event_types:?}",
        );
        let persisted_tool_use_id = raw_events
            .iter()
            .find(|e| e.event_type.as_deref() == Some("tool_result"))
            .and_then(|e| e.content.as_ref())
            .and_then(|c| c.get("tool_use_id"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert_eq!(
            persisted_tool_use_id, tool_use_id,
            "persisted tool_result must carry the wire tool_use_id (G0a contract)",
        );

        // Round-trip through the chat-side compaction pipeline. This
        // is the load-bearing assertion: it proves a future replay of
        // dev-loop events would feed `session_events_to_agent_history`
        // and emerge as a valid Anthropic message array.
        let history = events_to_session_history(
            &raw_events,
            PROJECT_AGENT_ID,
            project_id.to_string().as_str(),
        );
        let messages = session_events_to_agent_history(&history);
        assert_anthropic_messages_valid(&messages);
    }

    /// Slimmed copy of the chat-side validator (private to
    /// `compaction_tests.rs`). Walks every assistant message to
    /// collect known `tool_use` ids, then verifies every
    /// `tool_result` references a known id with no duplicates per
    /// user message — the exact two failure modes
    /// `session_events_to_agent_history` is supposed to prevent.
    fn assert_anthropic_messages_valid(history: &[serde_json::Value]) {
        use std::collections::HashSet;

        let mut known_tool_use_ids: HashSet<String> = HashSet::new();
        for (msg_idx, msg) in history.iter().enumerate() {
            let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or_default();
            let Some(content) = msg.get("content") else {
                panic!("message {msg_idx} has no `content` field");
            };
            let blocks: Vec<&serde_json::Value> = match content {
                serde_json::Value::Array(arr) => arr.iter().collect(),
                serde_json::Value::String(_) => continue,
                other => panic!("message {msg_idx} has non-string/non-array content: {other}"),
            };
            if role == "assistant" {
                for block in &blocks {
                    if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                            known_tool_use_ids.insert(id.to_string());
                        }
                    }
                }
            }
            if role == "user" {
                let mut seen: HashSet<String> = HashSet::new();
                for (block_idx, block) in blocks.iter().enumerate() {
                    if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                        continue;
                    }
                    let id = block
                        .get("tool_use_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    assert!(
                        !id.is_empty(),
                        "messages.{msg_idx}.content.{block_idx}: tool_result missing tool_use_id",
                    );
                    assert!(
                        seen.insert(id.clone()),
                        "messages.{msg_idx}.content.{block_idx}: duplicate tool_result for `{id}`",
                    );
                    assert!(
                        known_tool_use_ids.contains(&id),
                        "messages.{msg_idx}.content.{block_idx}: tool_result references unknown tool_use `{id}`",
                    );
                }
            }
        }
    }
}
