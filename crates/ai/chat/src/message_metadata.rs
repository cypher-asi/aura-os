use aura_core::ChatContentBlock;
use serde::{Deserialize, Serialize};
use tracing::warn;

const METADATA_PREFIX: &str = "{\"_aura_v\":";

#[derive(Serialize, Deserialize)]
struct WrappedMessage {
    _aura_v: u8,
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    blocks: Option<Vec<ChatContentBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thinking_ms: Option<u64>,
}

pub struct DecodedMessage {
    pub text: String,
    pub content_blocks: Option<Vec<ChatContentBlock>>,
    pub thinking: Option<String>,
    pub thinking_duration_ms: Option<u64>,
}

/// Encode a message's text and structured metadata into a single string for storage.
/// Returns plain text when no blocks or thinking are present (backward compatible).
pub fn encode_message_content(
    text: &str,
    content_blocks: Option<&[ChatContentBlock]>,
    thinking: Option<&str>,
    thinking_duration_ms: Option<u64>,
) -> String {
    let has_blocks = content_blocks.map_or(false, |b| !b.is_empty());
    let has_thinking = thinking.map_or(false, |t| !t.is_empty());

    if !has_blocks && !has_thinking {
        return text.to_string();
    }

    let wrapped = WrappedMessage {
        _aura_v: 1,
        text: text.to_string(),
        blocks: content_blocks.map(|b| b.to_vec()),
        thinking: thinking.map(|t| t.to_string()),
        thinking_ms: thinking_duration_ms,
    };

    match serde_json::to_string(&wrapped) {
        Ok(json) => json,
        Err(e) => {
            warn!(error = %e, "Failed to encode message metadata, falling back to plain text");
            text.to_string()
        }
    }
}

/// Decode a stored message string back into text and metadata.
/// Handles both plain text (old format) and JSON-wrapped (new format).
pub fn decode_message_content(raw: &str) -> DecodedMessage {
    if !raw.starts_with(METADATA_PREFIX) {
        return DecodedMessage {
            text: raw.to_string(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
        };
    }

    match serde_json::from_str::<WrappedMessage>(raw) {
        Ok(wrapped) => DecodedMessage {
            text: wrapped.text,
            content_blocks: wrapped.blocks,
            thinking: wrapped.thinking,
            thinking_duration_ms: wrapped.thinking_ms,
        },
        Err(e) => {
            warn!(error = %e, "Failed to decode message metadata, treating as plain text");
            DecodedMessage {
                text: raw.to_string(),
                content_blocks: None,
                thinking: None,
                thinking_duration_ms: None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plain_text_roundtrip() {
        let encoded = encode_message_content("Hello world", None, None, None);
        assert_eq!(encoded, "Hello world");
        let decoded = decode_message_content(&encoded);
        assert_eq!(decoded.text, "Hello world");
        assert!(decoded.content_blocks.is_none());
        assert!(decoded.thinking.is_none());
    }

    #[test]
    fn empty_blocks_treated_as_plain_text() {
        let encoded = encode_message_content("Hello", Some(&[]), None, None);
        assert_eq!(encoded, "Hello");
    }

    #[test]
    fn blocks_roundtrip() {
        let blocks = vec![
            ChatContentBlock::Text { text: "Hello".into() },
            ChatContentBlock::ToolUse {
                id: "t1".into(),
                name: "read_file".into(),
                input: json!({"path": "src/main.rs"}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "fn main() {}".into(),
                is_error: None,
            },
        ];
        let encoded = encode_message_content(
            "Here's the file",
            Some(&blocks),
            Some("Let me think about this"),
            Some(1500),
        );
        assert!(encoded.starts_with("{\"_aura_v\":"));

        let decoded = decode_message_content(&encoded);
        assert_eq!(decoded.text, "Here's the file");
        assert_eq!(decoded.content_blocks.as_ref().unwrap().len(), 3);
        assert_eq!(decoded.thinking.as_deref(), Some("Let me think about this"));
        assert_eq!(decoded.thinking_duration_ms, Some(1500));
    }

    #[test]
    fn backward_compat_plain_text() {
        let decoded = decode_message_content("Just some old message text");
        assert_eq!(decoded.text, "Just some old message text");
        assert!(decoded.content_blocks.is_none());
        assert!(decoded.thinking.is_none());
    }

    #[test]
    fn thinking_only_roundtrip() {
        let encoded = encode_message_content(
            "Response text",
            None,
            Some("deep thoughts"),
            Some(3000),
        );
        assert!(encoded.starts_with("{\"_aura_v\":"));

        let decoded = decode_message_content(&encoded);
        assert_eq!(decoded.text, "Response text");
        assert!(decoded.content_blocks.is_none());
        assert_eq!(decoded.thinking.as_deref(), Some("deep thoughts"));
        assert_eq!(decoded.thinking_duration_ms, Some(3000));
    }
}
