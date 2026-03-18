use std::collections::HashSet;

use tracing::warn;

use aura_claude::{ContentBlock, MessageContent, RichMessage};

use crate::ChatService;

impl ChatService {
    pub(crate) fn sanitize_orphan_tool_results(messages: Vec<RichMessage>) -> Vec<RichMessage> {
        let mut result = Vec::with_capacity(messages.len());
        for i in 0..messages.len() {
            let msg = &messages[i];
            let MessageContent::Blocks(blocks) = &msg.content else {
                result.push(msg.clone());
                continue;
            };
            let tool_result_blocks: Vec<_> = blocks
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::ToolResult { .. } => Some(b.clone()),
                    _ => None,
                })
                .collect();
            if tool_result_blocks.is_empty() || msg.role != "user" {
                result.push(msg.clone());
                continue;
            }
            let orig_count = tool_result_blocks.len();
            let valid_ids: HashSet<String> = match messages.get(i.wrapping_sub(1)) {
                Some(prev) if prev.role == "assistant" => match &prev.content {
                    MessageContent::Blocks(prev_blocks) => prev_blocks
                        .iter()
                        .filter_map(|b| match b {
                            ContentBlock::ToolUse { id, .. } => Some(id.clone()),
                            _ => None,
                        })
                        .collect(),
                    _ => HashSet::new(),
                },
                _ => HashSet::new(),
            };
            let kept: Vec<ContentBlock> = tool_result_blocks
                .into_iter()
                .filter_map(|b| match &b {
                    ContentBlock::ToolResult { tool_use_id, .. } if valid_ids.contains(tool_use_id) => {
                        Some(b)
                    }
                    ContentBlock::ToolResult { tool_use_id, .. } => {
                        warn!(tool_use_id, "Dropping orphan tool_result");
                        None
                    }
                    _ => None,
                })
                .collect();
            let other_blocks: Vec<ContentBlock> = blocks
                .iter()
                .filter(|b| !matches!(b, ContentBlock::ToolResult { .. }))
                .cloned()
                .collect();
            if kept.is_empty() && other_blocks.is_empty() {
                let preview: String = blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::ToolResult { content, .. } => Some(content.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(200)
                    .collect();
                warn!(preview = %preview, "Converting orphan tool_result message to text");
                result.push(RichMessage::user(&format!(
                    "[Previous tool result was lost due to context: {}]",
                    preview
                )));
            } else if kept.len() != orig_count {
                let mut new_blocks = other_blocks;
                new_blocks.extend(kept);
                result.push(RichMessage {
                    role: "user".into(),
                    content: MessageContent::Blocks(new_blocks),
                });
            } else {
                result.push(msg.clone());
            }
        }
        result
    }

    pub(crate) fn sanitize_tool_use_results(messages: Vec<RichMessage>) -> Vec<RichMessage> {
        let mut result = Vec::with_capacity(messages.len() + 16);
        let mut i = 0;
        while i < messages.len() {
            let msg = &messages[i];
            let tool_use_ids: Vec<String> = match &msg.content {
                MessageContent::Blocks(blocks) => blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::ToolUse { id, .. } => Some(id.clone()),
                        _ => None,
                    })
                    .collect(),
                MessageContent::Text(_) => vec![],
            };

            result.push(msg.clone());

            if tool_use_ids.is_empty() {
                i += 1;
                continue;
            }

            let next = messages.get(i + 1);
            let existing_ids: HashSet<String> = match next {
                Some(m) if m.role == "user" => match &m.content {
                    MessageContent::Blocks(blocks) => blocks
                        .iter()
                        .filter_map(|b| match b {
                            ContentBlock::ToolResult { tool_use_id, .. } => Some(tool_use_id.clone()),
                            _ => None,
                        })
                        .collect(),
                    _ => HashSet::new(),
                },
                _ => HashSet::new(),
            };

            let missing: Vec<String> = tool_use_ids
                .into_iter()
                .filter(|id| !existing_ids.contains(id))
                .collect();

            if !missing.is_empty() {
                warn!(
                    orphaned_count = missing.len(),
                    ids = ?missing,
                    "Adding synthetic tool_result for orphaned tool_use"
                );
                let synthetic: Vec<ContentBlock> = missing
                    .into_iter()
                    .map(|tool_use_id| ContentBlock::ToolResult {
                        tool_use_id: tool_use_id.clone(),
                        content: "Tool execution was interrupted or not completed."
                            .to_string(),
                        is_error: Some(true),
                    })
                    .collect();

                if let Some(m) = next {
                    if m.role == "user" {
                        if let MessageContent::Blocks(blocks) = &m.content {
                            let mut merged = blocks.clone();
                            for b in &synthetic {
                                merged.push(b.clone());
                            }
                            result.push(RichMessage {
                                role: "user".into(),
                                content: MessageContent::Blocks(merged),
                            });
                            i += 2;
                            continue;
                        }
                    }
                }
                result.push(RichMessage::tool_results(synthetic));
            }
            i += 1;
        }
        result
    }
}
