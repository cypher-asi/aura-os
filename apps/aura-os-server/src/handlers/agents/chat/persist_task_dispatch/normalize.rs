//! Tool-input normalisers: coerce inbound `tool_use.input` payloads
//! into the JSON object Anthropic's Messages API expects on replay,
//! and back-fill the matching `tool_use` block when a `tool_result`
//! lands for a tool whose input never streamed as a snapshot.

use serde_json::{json, Value};
use tracing::{error, trace};

use super::super::persist_task::PersistTaskState;

/// Classification of a coerced `tool_use.input` snapshot.
///
/// `is_streaming` is `true` when the inbound payload was a partial
/// JSON string mid-stream (Anthropic's `input_json_delta` accumulator
/// before the closing brace arrives). Callers should skip persistence
/// of those events — a later snapshot will land the canonical object —
/// and avoid mutating shared state with the throwaway placeholder.
#[derive(Debug, Clone)]
pub(super) struct CoercedToolInput {
    pub value: Value,
    pub is_streaming: bool,
}

/// Guarantee the inbound tool_use input is a JSON object before we persist
/// it, regardless of how the upstream harness serialized it, and report
/// whether the payload was a mid-stream accumulator.
///
/// The Anthropic Messages API rejects any persisted history whose
/// `tool_use.input` is not an object with
/// `messages.N.content.M.tool_use.input: Input should be an object`. Three
/// inbound shapes need different handling:
///
/// 1. **`Object`** — final snapshot or non-streaming tool. Used as-is.
/// 2. **`Null`** — non-streaming tool that never emitted a snapshot.
///    Coerced to `{}` (mirrors the long-standing `backfill_null_tool_use_input`
///    recovery).
/// 3. **`String`** — Anthropic's `input_json_delta` accumulator. The
///    `aura-protocol::ToolCallSnapshot` doc-comment ("incrementally
///    accumulated tool input") confirms this is the streaming case, not
///    corruption. We try to parse the string as JSON; if it yields an
///    object that's the final completed snapshot. Otherwise it's still
///    streaming — we return a `{}` placeholder, set `is_streaming = true`,
///    and log at `trace` (not `error`).
/// 4. **`Array` / `Number` / `Bool`** — genuine upstream corruption.
///    Anthropic never emits these for tool input. Logged at `error` and
///    replaced with a structured marker that records the original type
///    for forensics.
pub(super) fn coerce_tool_use_input_with_status(
    tool_use_id: &str,
    tool_name: &str,
    input: &Value,
) -> CoercedToolInput {
    match input {
        Value::Object(_) => CoercedToolInput {
            value: input.clone(),
            is_streaming: false,
        },
        Value::Null => CoercedToolInput {
            value: json!({}),
            is_streaming: false,
        },
        Value::String(s) => classify_string_input(tool_use_id, tool_name, s),
        other => CoercedToolInput {
            value: error_marker_for_wrong_type(tool_use_id, tool_name, other),
            is_streaming: false,
        },
    }
}

/// Thin wrapper that returns just the coerced value. Used at sites where
/// the caller does not branch on `is_streaming` (e.g. the tool_result
/// path, where streaming should have completed by the time the result
/// lands).
pub(super) fn coerce_tool_use_input_to_object(
    tool_use_id: &str,
    tool_name: &str,
    input: &Value,
) -> Value {
    coerce_tool_use_input_with_status(tool_use_id, tool_name, input).value
}

fn classify_string_input(tool_use_id: &str, tool_name: &str, s: &str) -> CoercedToolInput {
    match serde_json::from_str::<Value>(s) {
        Ok(parsed @ Value::Object(_)) => CoercedToolInput {
            value: parsed,
            is_streaming: false,
        },
        _ => {
            trace!(
                tool_use_id,
                tool_name,
                partial_size_bytes = s.len(),
                "tool_use.input arrived as partial JSON string mid-stream; \
                 using {{}} placeholder until a later snapshot completes the object"
            );
            CoercedToolInput {
                value: json!({}),
                is_streaming: true,
            }
        }
    }
}

fn error_marker_for_wrong_type(tool_use_id: &str, tool_name: &str, other: &Value) -> Value {
    let original_type = match other {
        Value::Array(_) => "array",
        Value::Number(_) => "number",
        Value::Bool(_) => "bool",
        Value::String(_) | Value::Null | Value::Object(_) => "unknown",
    };
    let original_size_bytes = serde_json::to_string(other).map(|s| s.len()).unwrap_or(0);
    error!(
        tool_use_id,
        tool_name,
        original_type,
        original_size_bytes,
        "tool_use.input arrived as non-object, non-string; replacing with \
         normalization marker so replay does not 400 on Anthropic. Upstream \
         is likely a tool snapshot regression."
    );
    json!({
        "_normalized": "non_object_input",
        "original_type": original_type,
        "original_size_bytes": original_size_bytes,
    })
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
    fn coerce_tool_use_input_complete_object_string_parses_through() {
        // Regression for the streaming-snapshot path: when Anthropic's
        // input_json_delta accumulator finishes assembling the input,
        // the final ToolCallSnapshot.input arrives as a `Value::String`
        // containing a complete JSON object. We must parse that string
        // rather than treat it as corruption.
        let coerced = coerce_tool_use_input_with_status(
            "tu_streamed",
            "read_file",
            &Value::String(r#"{"path":"src/lib.rs"}"#.to_string()),
        );
        assert!(
            !coerced.is_streaming,
            "complete object string is not streaming"
        );
        assert_eq!(coerced.value, json!({"path": "src/lib.rs"}));
    }

    #[test]
    fn coerce_tool_use_input_partial_json_string_is_streaming_placeholder() {
        // Mid-stream input_json_delta state — partial JSON that does not
        // parse yet. Returns a `{}` placeholder with `is_streaming = true`
        // so the caller can skip persistence. No error log.
        let coerced = coerce_tool_use_input_with_status(
            "tu_streaming",
            "list_files",
            &Value::String(r#"{"path":"src/"#.to_string()),
        );
        assert!(
            coerced.is_streaming,
            "partial JSON must be flagged as streaming"
        );
        assert_eq!(coerced.value, json!({}));
    }

    #[test]
    fn coerce_tool_use_input_empty_string_is_streaming_placeholder() {
        // The very first snapshot in a stream is typically `""` (2 bytes,
        // seen in the live trace). Must not trip the error path.
        let coerced = coerce_tool_use_input_with_status(
            "tu_start",
            "list_files",
            &Value::String(String::new()),
        );
        assert!(coerced.is_streaming);
        assert_eq!(coerced.value, json!({}));
    }

    #[test]
    fn coerce_tool_use_input_string_with_array_does_not_treat_as_streaming_object() {
        // A complete JSON value that isn't an object (e.g. an array)
        // must not pass through as `is_streaming = false`. We hold it as
        // a placeholder so the next snapshot — which should arrive as a
        // real object — supersedes it cleanly.
        let coerced = coerce_tool_use_input_with_status(
            "tu_array_string",
            "list_files",
            &Value::String("[1, 2, 3]".to_string()),
        );
        assert!(coerced.is_streaming);
        assert_eq!(coerced.value, json!({}));
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
    fn coerce_tool_use_input_number_becomes_normalization_marker() {
        let coerced = coerce_tool_use_input_to_object("tu_num", "list_files", &json!(42));
        assert!(coerced.is_object());
        assert_eq!(coerced["original_type"], "number");
    }

    #[test]
    fn coerce_tool_use_input_bool_becomes_normalization_marker() {
        let coerced = coerce_tool_use_input_to_object("tu_bool", "list_files", &json!(true));
        assert!(coerced.is_object());
        assert_eq!(coerced["original_type"], "bool");
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
    fn normalize_tool_use_input_with_complete_object_string_parses_through() {
        // If the tool_result lands while the snapshot is still a string
        // form (rare — streaming should have completed by then), accept
        // a complete JSON object string as canonical input rather than
        // failing replay.
        let mut state = state_with_pending_tool_use(
            "tu_late",
            "create_spec",
            Value::String(r#"{"title": "T"}"#.to_string()),
        );
        normalize_tool_use_input(&mut state, "tu_late", "create_spec");
        assert_eq!(state.content_blocks[0]["input"], json!({"title": "T"}));
    }

    #[test]
    fn normalize_tool_use_input_with_partial_string_backfills_empty_object() {
        // If somehow the tool_result lands with the snapshot still
        // mid-stream (truncated string), we fall back to `{}` so replay
        // does not 400; this is the same recovery the Null branch gets.
        let mut state = state_with_pending_tool_use(
            "tu_mid",
            "create_spec",
            Value::String(r#"{"title": "T"#.to_string()),
        );
        normalize_tool_use_input(&mut state, "tu_mid", "create_spec");
        assert_eq!(state.content_blocks[0]["input"], json!({}));
    }

    #[test]
    fn normalize_tool_use_input_replaces_wrong_type_with_marker() {
        // Array/number/bool inputs remain genuine corruption — the
        // marker path stays so forensic logs flag the upstream bug.
        let mut state = state_with_pending_tool_use("tu_1", "create_spec", json!([1, 2, 3]));
        normalize_tool_use_input(&mut state, "tu_1", "create_spec");
        let normalized = &state.content_blocks[0]["input"];
        assert!(normalized.is_object());
        assert_eq!(normalized["_normalized"], "non_object_input");
        assert_eq!(normalized["original_type"], "array");
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
