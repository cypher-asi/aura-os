//! Truncation and sanitization for streamed process events and persisted payloads.

use std::collections::HashSet;

const MAX_PROCESS_INPUT_SNAPSHOT_CHARS: usize = 16_000;
const MAX_PROCESS_TEXT_EVENT_CHARS: usize = 4_000;
const MAX_PROCESS_TOOL_RESULT_CHARS: usize = 8_000;
const MAX_PROCESS_WRITE_FILE_CONTENT_CHARS: usize = 4_000;
const MAX_ARTIFACT_CONTEXT_CHARS: usize = 16_000;

pub(crate) fn truncate_with_marker(input: &str, limit: usize) -> String {
    if input.chars().count() <= limit {
        return input.to_string();
    }

    let truncated: String = input.chars().take(limit).collect();
    format!("{truncated}\n[truncated]")
}

pub(crate) fn summarize_input_snapshot(input: &str) -> String {
    truncate_with_marker(input, MAX_PROCESS_INPUT_SNAPSHOT_CHARS)
}

pub(crate) fn truncate_for_artifact_context(content: &str) -> String {
    truncate_with_marker(content, MAX_ARTIFACT_CONTEXT_CHARS)
}

fn is_incomplete_write_input(input: &serde_json::Value) -> bool {
    match input {
        serde_json::Value::Null => true,
        serde_json::Value::Object(map) => {
            !matches!(map.get("content"), Some(serde_json::Value::String(_)))
        }
        _ => false,
    }
}

pub(crate) fn should_skip_streamed_process_event(payload: &serde_json::Value) -> bool {
    let event_type = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let tool_name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    if tool_name != "write_file" {
        return false;
    }

    match event_type {
        "tool_use_start" => true,
        "tool_call_snapshot" => payload
            .get("input")
            .map(is_incomplete_write_input)
            .unwrap_or(true),
        _ => false,
    }
}

fn truncate_object_string_field(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    limit: usize,
) {
    if let Some(serde_json::Value::String(value)) = map.get_mut(key) {
        if value.chars().count() > limit {
            *value = truncate_with_marker(value, limit);
        }
    }
}

pub(crate) fn sanitize_process_payload(mut payload: serde_json::Value) -> serde_json::Value {
    let Some(map) = payload.as_object_mut() else {
        return payload;
    };

    truncate_object_string_field(map, "text", MAX_PROCESS_TEXT_EVENT_CHARS);
    truncate_object_string_field(map, "delta", MAX_PROCESS_TEXT_EVENT_CHARS);
    truncate_object_string_field(map, "thinking", MAX_PROCESS_TEXT_EVENT_CHARS);
    truncate_object_string_field(map, "result", MAX_PROCESS_TOOL_RESULT_CHARS);

    if let Some(serde_json::Value::Object(input)) = map.get_mut("input") {
        truncate_object_string_field(input, "content", MAX_PROCESS_WRITE_FILE_CONTENT_CHARS);
    }

    payload
}

pub(crate) fn sanitize_content_blocks(blocks: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut sanitized = Vec::with_capacity(blocks.len());
    let mut suppressed_tool_use_ids = HashSet::new();

    for block in blocks {
        let mut block = block.clone();
        let block_type = block
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        match block_type {
            "tool_use" => {
                let tool_id = block
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let tool_name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                if tool_name == "write_file"
                    && block
                        .get("input")
                        .map(is_incomplete_write_input)
                        .unwrap_or(true)
                {
                    if !tool_id.is_empty() {
                        suppressed_tool_use_ids.insert(tool_id);
                    }
                    continue;
                }

                if let Some(serde_json::Value::Object(input)) = block.get_mut("input") {
                    truncate_object_string_field(
                        input,
                        "content",
                        MAX_PROCESS_WRITE_FILE_CONTENT_CHARS,
                    );
                }

                sanitized.push(block);
            }
            "tool_result" => {
                let tool_use_id = block
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if suppressed_tool_use_ids.contains(tool_use_id) {
                    continue;
                }
                if let Some(serde_json::Value::String(result)) = block.get_mut("result") {
                    if result.chars().count() > MAX_PROCESS_TOOL_RESULT_CHARS {
                        *result = truncate_with_marker(result, MAX_PROCESS_TOOL_RESULT_CHARS);
                    }
                }
                sanitized.push(block);
            }
            _ => sanitized.push(block),
        }
    }

    sanitized
}
