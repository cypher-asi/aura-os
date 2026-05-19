//! Per-event handlers used by the chat-persistence task. Split out of
//! `persist_task.rs` to keep both files within the 500-line cap.

use aura_os_harness::HarnessOutbound;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{error, warn};

use super::event_bus::publish_assistant_message_end_event;
use super::persist::ChatPersistCtx;
use super::persist_task::{
    flush_text_segment, log_stream_summary, message_id_for_synth, message_id_str, persist_event,
    PersistTaskState,
};

/// Dispatch a single harness outbound event. Returns `true` when the
/// event represents user-visible turn progress (text, thinking, tool
/// activity) that should fire a throttled progress publish at the end
/// of the loop iteration.
pub(super) async fn handle_outbound(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    evt: &HarnessOutbound,
    model: Option<&str>,
) -> bool {
    match evt {
        HarnessOutbound::AssistantMessageStart(start) => {
            handle_message_start(state, ctx, &start.message_id).await;
            true
        }
        HarnessOutbound::TextDelta(delta) => {
            handle_text_delta(state, ctx, &delta.text).await;
            true
        }
        HarnessOutbound::ThinkingDelta(delta) => {
            handle_thinking_delta(state, ctx, &delta.thinking).await;
            true
        }
        HarnessOutbound::ToolUseStart(tool) => {
            handle_tool_use_start(state, ctx, &tool.id, &tool.name).await;
            true
        }
        HarnessOutbound::ToolCallSnapshot(snap) => {
            handle_tool_call_snapshot(state, ctx, &snap.id, &snap.name, &snap.input).await;
            true
        }
        HarnessOutbound::ToolResult(result) => {
            // Use the wire `tool_use_id` whenever the harness supplies it.
            // Falling back to `state.last_tool_use_id` is a back-compat
            // shim for older harness builds; new builds (post the parallel
            // tool-call protocol fix) always set it. See the doc-comment
            // on `handle_tool_result` for why preferring the wire id is
            // load-bearing for parallel tool calls.
            handle_tool_result(
                state,
                ctx,
                result.tool_use_id.as_deref(),
                &result.name,
                &result.result,
                result.is_error,
            )
            .await;
            true
        }
        HarnessOutbound::AssistantMessageEnd(end) => {
            handle_message_end(state, ctx, event_bus, end, model).await;
            false
        }
        HarnessOutbound::Error(err) => {
            handle_error(state, ctx, event_bus, err, model).await;
            false
        }
        HarnessOutbound::SessionReady(_)
        | HarnessOutbound::GenerationStart(_)
        | HarnessOutbound::GenerationProgress(_)
        | HarnessOutbound::GenerationPartialImage(_)
        | HarnessOutbound::GenerationCompleted(_)
        | HarnessOutbound::GenerationError(_)
        | HarnessOutbound::ToolApprovalPrompt(_)
        // Progress heartbeats from the harness (Phase 6: `tool_running`
        // ticks every `AURA_TURN_TOOL_HEARTBEAT_INTERVAL_SECS`) are
        // transient liveness signals, not persistable turn progress —
        // they already flow through to the SSE forwarder so the chat
        // watchdog sees forward motion. We don't write them to
        // `SessionEvent`s and don't bump the throttled progress
        // publish (Progress is itself the progress publish).
        | HarnessOutbound::Progress(_) => false,
    }
}

async fn handle_message_start(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    state.message_id = message_id.to_string();
    if persist_event(
        ctx,
        "assistant_message_start",
        json!({
            "message_id": message_id,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

async fn handle_text_delta(state: &mut PersistTaskState, ctx: &ChatPersistCtx, text: &str) {
    state.text_delta_count += 1;
    state.total_text_bytes += text.len();
    state.full_text.push_str(text);
    state.text_segment.push_str(text);
    if persist_event(
        ctx,
        "text_delta",
        json!({
            "message_id": &state.message_id,
            "text": text,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

async fn handle_thinking_delta(state: &mut PersistTaskState, ctx: &ChatPersistCtx, thinking: &str) {
    state.thinking_delta_count += 1;
    state.total_thinking_bytes += thinking.len();
    state.thinking_buf.push_str(thinking);
    if persist_event(
        ctx,
        "thinking_delta",
        json!({
            "message_id": &state.message_id,
            "thinking": thinking,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

async fn handle_tool_use_start(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    id: &str,
    name: &str,
) {
    state.tool_use_count += 1;
    flush_text_segment(state);
    state.last_tool_use_id = id.to_string();
    state.content_blocks.push(json!({
        "type": "tool_use",
        "id": id,
        "name": name,
        "input": Value::Null,
    }));
    if persist_event(
        ctx,
        "tool_use_start",
        json!({
            "message_id": &state.message_id,
            "id": id,
            "name": name,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

async fn handle_tool_call_snapshot(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    id: &str,
    name: &str,
    input: &Value,
) {
    let sanitized = coerce_tool_use_input_to_object(id, name, input);
    update_or_append_tool_use_input(state, id, name, &sanitized);
    if persist_event(
        ctx,
        "tool_call_snapshot",
        json!({
            "message_id": &state.message_id,
            "id": id,
            "name": name,
            "input": &sanitized,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

fn update_or_append_tool_use_input(
    state: &mut PersistTaskState,
    id: &str,
    name: &str,
    input: &Value,
) {
    if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && b.get("id").and_then(|i| i.as_str()) == Some(id)
    }) {
        block["input"] = input.clone();
    } else {
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input,
        }));
    }
}

/// Guarantee the inbound tool_use input is a JSON object before we persist
/// it, regardless of how the upstream harness serialized it.
///
/// The Anthropic Messages API rejects any persisted history whose
/// `tool_use.input` is not an object with
/// `messages.N.content.M.tool_use.input: Input should be an object`, so an
/// upstream bug that hands us a `String`, `Array`, number, or bool would
/// silently poison every subsequent turn for the same session.
///
/// `null` is silently coerced to `{}` to keep parity with the
/// long-standing `backfill_null_tool_use_input` recovery for non-streaming
/// tools. Any other non-object shape is logged at `error` (so the harness
/// log surfacing in `infra/evals/external/bin/follow-harness-log.mjs`
/// flags it loudly) and replaced with a structured marker that records
/// what the original type was for forensics.
fn coerce_tool_use_input_to_object(tool_use_id: &str, tool_name: &str, input: &Value) -> Value {
    match input {
        Value::Object(_) => input.clone(),
        Value::Null => json!({}),
        other => {
            let original_type = match other {
                Value::String(_) => "string",
                Value::Array(_) => "array",
                Value::Number(_) => "number",
                Value::Bool(_) => "bool",
                Value::Null | Value::Object(_) => unreachable!(),
            };
            let original_size_bytes = serde_json::to_string(other).map(|s| s.len()).unwrap_or(0);
            error!(
                tool_use_id,
                tool_name,
                original_type,
                original_size_bytes,
                "tool_use.input arrived as non-object; replacing with normalization marker so \
                 replay does not 400 on Anthropic. Upstream is likely aura-harness compaction \
                 or a tool snapshot regression."
            );
            json!({
                "_normalized": "non_object_input",
                "original_type": original_type,
                "original_size_bytes": original_size_bytes,
            })
        }
    }
}

/// Persist a `tool_result` and append the matching block to the in-flight
/// assistant turn.
///
/// `wire_tool_use_id` is the id the harness paired to this result on the wire.
/// We **must** prefer it over `state.last_tool_use_id`: the latter tracks the
/// most recent `tool_use_start`, which is wrong whenever the model emits
/// multiple `tool_use` blocks in a single assistant turn (Anthropic's
/// parallel-tool-call pattern). In that case the harness streams:
///
/// ```text
/// tool_use_start(A) tool_use_start(B) ... tool_use_start(N)
/// tool_result(A) tool_result(B) ... tool_result(N)
/// ```
///
/// and if we tagged every result with `state.last_tool_use_id` they would all
/// inherit id `N`. The persisted assistant turn would carry N duplicate
/// `tool_result` blocks pointing at `N`, and the very next replay through
/// `session_events_to_agent_history` would 400 on Anthropic with
/// `messages.K.content.M: each tool_use must have a single result.
/// Found multiple tool_result blocks with id: <N>`.
///
/// `wire_tool_use_id == None` is the back-compat fallback for older harness
/// builds (or test harnesses) that omit `ToolResultMsg.tool_use_id`. In that
/// case we still use `state.last_tool_use_id` — which is correct for the
/// sequential, one-tool-at-a-time pattern those builds emit — and bail out
/// only if it too is empty (no preceding `tool_use_start`).
async fn handle_tool_result(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    wire_tool_use_id: Option<&str>,
    name: &str,
    result: &str,
    is_error: bool,
) {
    let tool_use_id = wire_tool_use_id
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| state.last_tool_use_id.clone());

    if tool_use_id.is_empty() {
        // Neither the wire payload nor any prior tool_use_start gave us
        // an id to pair with. Persisting an id-less tool_result would
        // round-trip as a dangling block that 400s Anthropic on replay
        // (`each tool_use must have a single result`). Drop the row and
        // surface a loud warning so the harness regression is visible.
        warn!(
            session_id = %ctx.session_id,
            project_agent_id = %ctx.project_agent_id,
            tool_name = name,
            "tool_result arrived without a tool_use_id and no prior tool_use_start; dropping to avoid corrupting replay"
        );
        return;
    }

    normalize_tool_use_input(state, &tool_use_id, name);

    state.content_blocks.push(json!({
        "type": "tool_result",
        "tool_use_id": &tool_use_id,
        "content": result,
        "is_error": is_error,
    }));
    if persist_event(
        ctx,
        "tool_result",
        json!({
            "message_id": &state.message_id,
            "tool_use_id": &tool_use_id,
            "name": name,
            "result": result,
            "is_error": is_error,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

/// Ensure the `tool_use` block that this result is paired with has a
/// JSON-object `input` before we persist the matching `tool_result`.
/// Non-streaming tools never emit a snapshot, so without this recovery the
/// persisted tool_use block would round-trip with `input: null` and be
/// rejected by the LLM on replay; this also catches non-object inputs that
/// survived from a buggy upstream snapshot (see `coerce_tool_use_input_to_object`).
///
/// We look up the block by `tool_use_id` instead of taking the trailing
/// `tool_use` block — the latter is only correct for sequential tool calls.
/// With parallel calls (`tool_use_start(A) tool_use_start(B) ... tool_result(A)`)
/// the trailing block would be `B`, and we would silently normalize the wrong
/// tool's input while leaving `A`'s input as the original `Null`.
fn normalize_tool_use_input(state: &mut PersistTaskState, tool_use_id: &str, tool_name: &str) {
    if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && b.get("id").and_then(|i| i.as_str()) == Some(tool_use_id)
    }) {
        let current = block.get("input").cloned().unwrap_or(Value::Null);
        if !current.is_object() {
            block["input"] = coerce_tool_use_input_to_object(tool_use_id, tool_name, &current);
        }
    }
}

async fn handle_message_end(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    end: &aura_os_harness::AssistantMessageEnd,
    model: Option<&str>,
) {
    flush_text_segment(state);
    let payload = json!({
        "message_id": &end.message_id,
        "text": &state.full_text,
        "thinking": if state.thinking_buf.is_empty() {
            Value::Null
        } else {
            Value::String(state.thinking_buf.clone())
        },
        "content_blocks": &state.content_blocks,
        "usage": &end.usage,
        "files_changed": &end.files_changed,
        "stop_reason": &end.stop_reason,
        "seq": state.seq,
    });
    if persist_event(ctx, "assistant_message_end", payload).await {
        state.persisted_events += 1;
        state.end_persisted = true;
        publish_assistant_message_end_event(event_bus, ctx, &end.message_id);
        log_stream_summary(
            state,
            ctx,
            model,
            &end.stop_reason,
            false,
            "assistant_message_end",
        );
    }
}

async fn handle_error(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    err: &aura_os_harness::ErrorMsg,
    model: Option<&str>,
) {
    if persist_event(
        ctx,
        "error",
        json!({
            "message_id": &state.message_id,
            "code": &err.code,
            "message": &err.message,
            "recoverable": err.recoverable,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }

    if state.end_persisted
        || !state.full_text.is_empty()
        || !state.content_blocks.is_empty()
        || !state.thinking_buf.is_empty()
    {
        return;
    }

    synthesize_error_message_end(state, ctx, event_bus, err, model).await;
}

/// If the harness errored before producing any text, thinking, or
/// tool blocks (e.g. auth, credits, provider 4xx on first byte), no
/// `assistant_message_end` will ever arrive. The broadcast-closed
/// safety net only fires when *some* output has accumulated, so the
/// turn would otherwise round-trip as "user message with no assistant
/// reply" on every reopen. Persist a minimal synthesized end row here
/// so the turn is recoverable.
async fn synthesize_error_message_end(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    err: &aura_os_harness::ErrorMsg,
    model: Option<&str>,
) {
    let err_summary = if err.message.trim().is_empty() {
        format!("(agent error: {})", err.code)
    } else {
        format!("(agent error: {})", err.message)
    };
    let end_payload = json!({
        "message_id": message_id_for_synth(state),
        "text": err_summary,
        "thinking": Value::Null,
        "content_blocks": [],
        "usage": Value::Null,
        "files_changed": {
            "created": [],
            "modified": [],
            "deleted": [],
        },
        "stop_reason": "error",
        "seq": state.seq + 1,
        "synthesized": true,
        "error_code": &err.code,
    });
    if persist_event(ctx, "assistant_message_end", end_payload).await {
        state.persisted_events += 1;
        state.end_persisted = true;
        publish_assistant_message_end_event(event_bus, ctx, message_id_str(state));
        log_stream_summary(state, ctx, model, "error", true, "error");
        warn!(
            session_id = %ctx.session_id,
            error_code = %err.code,
            "Synthesized assistant_message_end after early harness error"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with_pending_tool_use(id: &str, name: &str, input: Value) -> PersistTaskState {
        let mut state = PersistTaskState::new();
        state.last_tool_use_id = id.to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input,
        }));
        state
    }

    #[test]
    fn coerce_tool_use_input_object_passes_through() {
        let input = json!({"title": "T", "markdown_contents": "ok"});
        let coerced = coerce_tool_use_input_to_object("tu_1", "create_spec", &input);
        assert_eq!(coerced, input);
    }

    #[test]
    fn coerce_tool_use_input_null_becomes_empty_object() {
        let coerced = coerce_tool_use_input_to_object("tu_1", "list_files", &Value::Null);
        assert_eq!(coerced, json!({}));
    }

    #[test]
    fn coerce_tool_use_input_string_becomes_normalization_marker() {
        // Regression for the aura-harness aura-compaction bug that wrote a
        // truncated JSON string back into tool_use.input. Anthropic rejects
        // such a message with 400 `Input should be an object`; we coerce
        // it to a structured object so replay can proceed.
        let coerced = coerce_tool_use_input_to_object(
            "tu_corrupt",
            "create_spec",
            &Value::String("\"truncated junk\"".repeat(100)),
        );
        assert!(coerced.is_object());
        assert_eq!(coerced["_normalized"], "non_object_input");
        assert_eq!(coerced["original_type"], "string");
        assert!(coerced["original_size_bytes"].as_u64().unwrap() > 0);
    }

    #[test]
    fn coerce_tool_use_input_array_becomes_normalization_marker() {
        let coerced = coerce_tool_use_input_to_object(
            "tu_array",
            "list_files",
            &json!(["not", "an", "object"]),
        );
        assert!(coerced.is_object());
        assert_eq!(coerced["original_type"], "array");
    }

    #[test]
    fn normalize_tool_use_input_backfills_null_to_empty_object() {
        // Pre-existing behavior: non-streaming tools never emit a snapshot,
        // so the persisted tool_use lands with `input: null`. We keep
        // backfilling those to `{}` so they replay cleanly.
        let mut state = state_with_pending_tool_use("tu_1", "list_files", Value::Null);
        normalize_tool_use_input(&mut state, "tu_1", "list_files");
        assert_eq!(state.content_blocks[0]["input"], json!({}));
    }

    #[test]
    fn normalize_tool_use_input_leaves_objects_unchanged() {
        let original = json!({"path": "src/lib.rs"});
        let mut state = state_with_pending_tool_use("tu_1", "read_file", original.clone());
        normalize_tool_use_input(&mut state, "tu_1", "read_file");
        assert_eq!(state.content_blocks[0]["input"], original);
    }

    #[test]
    fn normalize_tool_use_input_replaces_string_with_marker() {
        let mut state = state_with_pending_tool_use(
            "tu_1",
            "create_spec",
            Value::String("oops not an object".into()),
        );
        normalize_tool_use_input(&mut state, "tu_1", "create_spec");
        let normalized = &state.content_blocks[0]["input"];
        assert!(normalized.is_object());
        assert_eq!(normalized["_normalized"], "non_object_input");
        assert_eq!(normalized["original_type"], "string");
    }

    #[test]
    fn normalize_tool_use_input_targets_the_id_not_the_trailing_block() {
        // Regression for the parallel tool-call bug: when the assistant
        // turn carries multiple pending `tool_use` blocks
        // (A then B then C, all with `input: null`) and the first
        // `tool_result` lands for A, we must normalize A's input, not
        // the trailing block C. The old `.rev().find()` shortcut found
        // C first and silently left A as `Null` — so A's tool_use
        // round-tripped to Anthropic with `input: null` and 400'd on
        // the next turn.
        let mut state = PersistTaskState::new();
        for id in ["A", "B", "C"] {
            state.last_tool_use_id = id.to_string();
            state.content_blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": "create_spec",
                "input": Value::Null,
            }));
        }

        normalize_tool_use_input(&mut state, "A", "create_spec");

        let a_input = &state.content_blocks[0]["input"];
        assert_eq!(a_input, &json!({}), "A's input must be backfilled");
        assert_eq!(
            state.content_blocks[1]["input"],
            Value::Null,
            "B's input must be untouched by an A-targeted normalization"
        );
        assert_eq!(
            state.content_blocks[2]["input"],
            Value::Null,
            "C's input must be untouched by an A-targeted normalization"
        );
    }

    #[tokio::test]
    async fn handle_tool_result_prefers_wire_tool_use_id_for_parallel_calls() {
        // The exact crash signature reported by the long 7-spec generation
        // run: 7 `tool_use_start`s buffered before any `tool_result`, then
        // 7 `tool_result`s stream back in order. Each must be tagged with
        // the id the harness paired it with on the wire, not with
        // `state.last_tool_use_id` (which would point at the final
        // `tool_use_start` and produce 7 duplicate `tool_result` blocks
        // for that one id — the precise input that 400s Anthropic with
        // `each tool_use must have a single result. Found multiple
        // tool_result blocks with id: <N>`).
        let mut state = PersistTaskState::new();
        state.message_id = "msg-parallel".to_string();
        let ids = ["A", "B", "C", "D", "E", "F", "G"];
        for id in ids {
            state.last_tool_use_id = id.to_string();
            state.content_blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": "create_spec",
                "input": json!({"title": format!("spec-{id}")}),
            }));
        }
        assert_eq!(
            state.last_tool_use_id, "G",
            "the buggy code would tag every tool_result with 'G'"
        );

        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        for id in ids {
            handle_tool_result(
                &mut state,
                &ctx,
                Some(id),
                "create_spec",
                "spec-id-result",
                false,
            )
            .await;
        }

        let tool_result_ids: Vec<&str> = state
            .content_blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
            .map(|b| b.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or(""))
            .collect();
        assert_eq!(
            tool_result_ids,
            vec!["A", "B", "C", "D", "E", "F", "G"],
            "every tool_result must be paired with the wire `tool_use_id`, not state.last_tool_use_id"
        );

        let mut counts = std::collections::HashMap::<&str, usize>::new();
        for id in &tool_result_ids {
            *counts.entry(*id).or_insert(0) += 1;
        }
        for (id, count) in &counts {
            assert_eq!(
                *count, 1,
                "tool_use_id `{id}` must have exactly one tool_result block, not {count}"
            );
        }
    }

    #[tokio::test]
    async fn handle_tool_result_falls_back_to_last_tool_use_id_when_wire_id_missing() {
        // Back-compat: older harness builds (or test harnesses) omit
        // `ToolResultMsg.tool_use_id`. For the sequential one-tool-at-a-time
        // pattern those builds emit, `state.last_tool_use_id` still
        // identifies the right tool, so we keep the fallback path
        // working.
        let mut state = state_with_pending_tool_use("tu_legacy", "read_file", Value::Null);
        state.message_id = "msg-legacy".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_result(&mut state, &ctx, None, "read_file", "ok", false).await;

        let last = state.content_blocks.last().expect("tool_result appended");
        assert_eq!(last["type"], "tool_result");
        assert_eq!(last["tool_use_id"], "tu_legacy");
    }

    #[tokio::test]
    async fn handle_tool_result_drops_event_when_no_id_available() {
        // Defensive: a wire payload missing `tool_use_id` AND no prior
        // `tool_use_start` (so `state.last_tool_use_id` is empty) gives
        // us nothing to pair the result with. Persisting an empty id
        // would round-trip as a dangling tool_result and 400 Anthropic
        // on the next turn. Drop it and warn instead.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-orphan".to_string();
        let ctx = ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        handle_tool_result(&mut state, &ctx, None, "ghost_tool", "ok", false).await;

        assert!(
            state.content_blocks.is_empty(),
            "tool_result with no id must not be appended to the assistant turn"
        );
    }

    #[test]
    fn update_or_append_tool_use_appends_when_id_missing() {
        let mut state = PersistTaskState::new();
        update_or_append_tool_use_input(&mut state, "tu_new", "list_files", &json!({}));
        assert_eq!(state.content_blocks.len(), 1);
        assert_eq!(state.content_blocks[0]["id"], "tu_new");
        assert_eq!(state.content_blocks[0]["input"], json!({}));
    }

    #[test]
    fn update_or_append_tool_use_updates_existing_block() {
        let mut state = state_with_pending_tool_use("tu_1", "create_spec", Value::Null);
        update_or_append_tool_use_input(
            &mut state,
            "tu_1",
            "create_spec",
            &json!({"title": "Phase 06", "markdown_contents": "..."}),
        );
        assert_eq!(state.content_blocks.len(), 1);
        assert_eq!(state.content_blocks[0]["input"]["title"], "Phase 06");
    }
}
