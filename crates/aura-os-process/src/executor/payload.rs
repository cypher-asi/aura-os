//! Truncation and sanitization for streamed process events and persisted payloads.

use std::collections::HashSet;

const MAX_PROCESS_INPUT_SNAPSHOT_CHARS: usize = 16_000;
const MAX_PROCESS_TEXT_EVENT_CHARS: usize = 4_000;
const MAX_PROCESS_TOOL_RESULT_CHARS: usize = 8_000;
const MAX_PROCESS_WRITE_FILE_CONTENT_CHARS: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputCompactionMode {
    None,
    Trim,
    Json,
    Auto,
}

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

pub(crate) fn parse_output_compaction_mode(
    raw: Option<&str>,
    default: OutputCompactionMode,
) -> OutputCompactionMode {
    let Some(raw) = raw else {
        return default;
    };

    match raw.trim().to_ascii_lowercase().as_str() {
        "none" | "off" | "full" => OutputCompactionMode::None,
        "trim" | "text" => OutputCompactionMode::Trim,
        "json" | "compact_json" | "minify_json" => OutputCompactionMode::Json,
        "auto" => OutputCompactionMode::Auto,
        _ => default,
    }
}

pub(crate) fn compact_process_output(
    content: &str,
    mode: OutputCompactionMode,
    max_chars: Option<usize>,
) -> String {
    let mut compacted = match mode {
        OutputCompactionMode::None => content.to_string(),
        OutputCompactionMode::Trim => content.trim().to_string(),
        OutputCompactionMode::Json => {
            compact_json_string(content).unwrap_or_else(|| content.trim().to_string())
        }
        OutputCompactionMode::Auto => {
            let trimmed = content.trim();
            compact_json_string(trimmed).unwrap_or_else(|| trimmed.to_string())
        }
    };

    if let Some(limit) = max_chars.filter(|limit| *limit > 0) {
        compacted = truncate_with_marker(&compacted, limit);
    }

    compacted
}

fn compact_json_string(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Some(String::new());
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .ok()
        .and_then(|value| serde_json::to_string(&value).ok())
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

#[cfg(test)]
mod tests {
    use super::{compact_process_output, parse_output_compaction_mode, OutputCompactionMode};

    #[test]
    fn compact_process_output_minifies_json_in_auto_mode() {
        let compacted = compact_process_output(
            "{\n  \"name\": \"Aura\",\n  \"items\": [1, 2]\n}\n",
            OutputCompactionMode::Auto,
            None,
        );

        assert_eq!(compacted, r#"{"items":[1,2],"name":"Aura"}"#);
    }

    #[test]
    fn compact_process_output_truncates_after_compaction() {
        let compacted =
            compact_process_output("   hello world   ", OutputCompactionMode::Trim, Some(5));

        assert_eq!(compacted, "hello\n[truncated]");
    }

    #[test]
    fn parse_output_compaction_mode_uses_default_for_unknown_values() {
        let mode = parse_output_compaction_mode(Some("surprise"), OutputCompactionMode::Auto);

        assert_eq!(mode, OutputCompactionMode::Auto);
    }
}
