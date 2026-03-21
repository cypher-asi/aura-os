use aura_core::*;
use aura_claude::{ContentBlock, ImageSource, MessageContent, RichMessage};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tracing::warn;

use crate::chat::ChatAttachment;

fn convert_content_blocks(blocks: &[ChatContentBlock], role: &str) -> Vec<RichMessage> {
    let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
    let mut tool_result_blocks: Vec<ContentBlock> = Vec::new();

    for b in blocks {
        match b {
            ChatContentBlock::Text { text } => {
                assistant_blocks.push(ContentBlock::Text {
                    text: text.clone(),
                });
            }
            ChatContentBlock::ToolUse { id, name, input } => {
                assistant_blocks.push(ContentBlock::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                });
            }
            ChatContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                let block = ContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: content.clone(),
                    is_error: *is_error,
                };
                if role == "assistant" {
                    tool_result_blocks.push(block);
                } else {
                    assistant_blocks.push(block);
                }
            }
            ChatContentBlock::Image { media_type, data } => {
                assistant_blocks.push(ContentBlock::Image {
                    source: ImageSource {
                        source_type: "base64".to_string(),
                        media_type: media_type.clone(),
                        data: data.clone(),
                    },
                });
            }
            ChatContentBlock::TaskRef { .. } | ChatContentBlock::SpecRef { .. } => {}
        }
    }

    let mut result = vec![RichMessage {
        role: role.to_string(),
        content: MessageContent::Blocks(assistant_blocks),
    }];
    if !tool_result_blocks.is_empty() {
        result.push(RichMessage {
            role: "user".to_string(),
            content: MessageContent::Blocks(tool_result_blocks),
        });
    }
    result
}

pub(crate) fn convert_messages_to_rich(messages: &[Message]) -> Vec<RichMessage> {
    messages
        .iter()
        .filter(|m| m.role == ChatRole::User || m.role == ChatRole::Assistant)
        .flat_map(|m| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                ChatRole::System => "user",
            };
            if let Some(blocks) = &m.content_blocks {
                convert_content_blocks(blocks, role)
            } else {
                vec![RichMessage {
                    role: role.to_string(),
                    content: MessageContent::Text(m.content.clone()),
                }]
            }
        })
        .collect()
}

pub(crate) fn build_attachment_blocks(
    content: &str,
    attachments: &[ChatAttachment],
) -> Option<Vec<ChatContentBlock>> {
    if attachments.is_empty() {
        return None;
    }
    let mut blocks: Vec<ChatContentBlock> = Vec::new();
    if !content.trim().is_empty() {
        blocks.push(ChatContentBlock::Text {
            text: content.to_string(),
        });
    }
    for att in attachments {
        if att.type_ == "image" {
            blocks.push(ChatContentBlock::Image {
                media_type: att.media_type.clone(),
                data: att.data.clone(),
            });
        } else if att.type_ == "text" {
            let text = match B64.decode(&att.data) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(e) => {
                    warn!(
                        name = att.name.as_deref().unwrap_or("<unnamed>"),
                        error = %e,
                        "Skipping text attachment with invalid base64"
                    );
                    continue;
                }
            };
            let header = att
                .name
                .as_deref()
                .map(|n| format!("[File: {}]\n\n", n))
                .unwrap_or_default();
            blocks.push(ChatContentBlock::Text {
                text: format!("{}{}", header, text),
            });
        }
    }
    if blocks.is_empty() { None } else { Some(blocks) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_claude::MessageContent;
    use chrono::Utc;

    fn make_message(role: ChatRole, content: &str) -> Message {
        Message {
            message_id: MessageId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role,
            content: content.into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn convert_empty_messages() {
        let result = convert_messages_to_rich(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn convert_text_only_messages() {
        let messages = vec![
            make_message(ChatRole::User, "Hello"),
            make_message(ChatRole::Assistant, "Hi there"),
        ];
        let rich = convert_messages_to_rich(&messages);
        assert_eq!(rich.len(), 2);
        assert_eq!(rich[0].role, "user");
        assert_eq!(rich[1].role, "assistant");
        match &rich[0].content {
            MessageContent::Text(t) => assert_eq!(t, "Hello"),
            _ => panic!("expected Text content"),
        }
    }

    #[test]
    fn convert_system_message_mapped_to_user() {
        let messages = vec![make_message(ChatRole::System, "system msg")];
        let rich = convert_messages_to_rich(&messages);
        assert!(rich.is_empty(), "System messages should be filtered out");
    }

    #[test]
    fn convert_messages_with_content_blocks() {
        let mut msg = make_message(ChatRole::User, "");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text {
                text: "check this".into(),
            },
            ChatContentBlock::ToolUse {
                id: "t1".into(),
                name: "read_file".into(),
                input: serde_json::json!({"path": "a.rs"}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "file contents".into(),
                is_error: None,
            },
            ChatContentBlock::Image {
                media_type: "image/png".into(),
                data: "base64data".into(),
            },
        ]);

        let rich = convert_messages_to_rich(&[msg]);
        assert_eq!(rich.len(), 1);
        match &rich[0].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 4);
                matches!(&blocks[0], ContentBlock::Text { .. });
                matches!(&blocks[1], ContentBlock::ToolUse { .. });
                matches!(&blocks[2], ContentBlock::ToolResult { .. });
                matches!(&blocks[3], ContentBlock::Image { .. });
            }
            _ => panic!("expected Blocks content"),
        }
    }

    #[test]
    fn convert_splits_tool_results_from_assistant_message() {
        let mut msg = make_message(ChatRole::Assistant, "");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text {
                text: "I'll read the file".into(),
            },
            ChatContentBlock::ToolUse {
                id: "t1".into(),
                name: "read_file".into(),
                input: serde_json::json!({"path": "a.rs"}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "file contents".into(),
                is_error: None,
            },
        ]);

        let rich = convert_messages_to_rich(&[msg]);
        assert_eq!(rich.len(), 2, "assistant msg with ToolResult should split into 2 messages");
        assert_eq!(rich[0].role, "assistant");
        assert_eq!(rich[1].role, "user");
        match &rich[0].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 2);
                assert!(matches!(&blocks[0], ContentBlock::Text { .. }));
                assert!(matches!(&blocks[1], ContentBlock::ToolUse { .. }));
            }
            _ => panic!("expected Blocks content for assistant"),
        }
        match &rich[1].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                assert!(matches!(&blocks[0], ContentBlock::ToolResult { .. }));
            }
            _ => panic!("expected Blocks content for tool_results user msg"),
        }
    }

    #[test]
    fn convert_filters_out_system_keeps_user_and_assistant() {
        let messages = vec![
            make_message(ChatRole::System, "sys"),
            make_message(ChatRole::User, "u1"),
            make_message(ChatRole::Assistant, "a1"),
            make_message(ChatRole::User, "u2"),
        ];
        let rich = convert_messages_to_rich(&messages);
        assert_eq!(rich.len(), 3);
        assert_eq!(rich[0].role, "user");
        assert_eq!(rich[1].role, "assistant");
        assert_eq!(rich[2].role, "user");
    }
}
