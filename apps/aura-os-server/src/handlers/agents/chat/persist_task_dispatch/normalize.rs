//! Tool-input normalisers: coerce inbound `tool_use.input` payloads
//! into the JSON object Anthropic's Messages API expects on replay,
//! and back-fill the matching `tool_use` block when a `tool_result`
//! lands for a tool whose input never streamed as a snapshot.

use serde_json::{json, Value};
use tracing::error;

use super::super::persist_task::PersistTaskState;

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
pub(super) fn coerce_tool_use_input_to_object(
    tool_use_id: &str,
    tool_name: &str,
    input: &Value,
) -> Value {
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
pub(super) fn normalize_tool_use_input(
    state: &mut PersistTaskState,
    tool_use_id: &str,
    tool_name: &str,
) {
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
}
