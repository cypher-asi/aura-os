use std::collections::HashSet;

use tracing::warn;

use aura_os_core::ChatContentBlock;

/// Deserialize a stored `content_blocks` JSON array per-entry so that one
/// malformed or unknown variant does not discard the whole vector.
///
/// Anything that fails to deserialize into a known `ChatContentBlock` variant
/// is logged and skipped. This is strictly more forgiving than
/// `serde_json::from_value::<Vec<ChatContentBlock>>`, which is all-or-nothing.
pub(super) fn deserialize_content_blocks(
    event_id: &str,
    raw_blocks: Vec<serde_json::Value>,
) -> Vec<ChatContentBlock> {
    let mut blocks = Vec::with_capacity(raw_blocks.len());
    for (idx, raw) in raw_blocks.into_iter().enumerate() {
        match serde_json::from_value::<ChatContentBlock>(raw.clone()) {
            Ok(block) => blocks.push(block),
            Err(error) => {
                let block_type = raw
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("<unknown>");
                warn!(
                    %event_id,
                    block_index = idx,
                    block_type,
                    %error,
                    "skipping unparseable chat content block while reconstructing assistant turn"
                );
            }
        }
    }
    blocks
}

pub(super) fn sanitize_assistant_content_blocks(
    blocks: Vec<ChatContentBlock>,
) -> Vec<ChatContentBlock> {
    let mut suppressed_tool_use_ids = HashSet::new();
    let mut sanitized = Vec::with_capacity(blocks.len());

    for block in blocks {
        match block {
            ChatContentBlock::ToolUse { id, name, input }
                if is_incomplete_write_tool_use(&name, &input) =>
            {
                suppressed_tool_use_ids.insert(id);
            }
            ChatContentBlock::ToolResult { tool_use_id, .. }
                if suppressed_tool_use_ids.contains(&tool_use_id) =>
            {
                continue;
            }
            other => sanitized.push(other),
        }
    }

    sanitized
}

fn is_incomplete_write_tool_use(name: &str, input: &serde_json::Value) -> bool {
    if name != "write_file" {
        return false;
    }

    match input {
        serde_json::Value::Null => true,
        serde_json::Value::Object(map) => {
            !matches!(map.get("content"), Some(serde_json::Value::String(_)))
        }
        _ => false,
    }
}
