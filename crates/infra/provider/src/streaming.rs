//! Streaming event types and accumulator.

use crate::request::{ModelResponse, StopReason, Usage};

/// The type of content currently being streamed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamContentType {
    /// Regular text output.
    Text,
    /// Extended thinking output.
    Thinking,
    /// JSON input for a tool call.
    ToolInput,
}

/// Events emitted during a streaming completion.
#[derive(Debug, Clone)]
pub enum StreamEvent {
    /// Start of a new message.
    MessageStart {
        /// The model serving the request.
        model: String,
    },
    /// A chunk of text content.
    TextDelta(String),
    /// A chunk of thinking content.
    ThinkingDelta(String),
    /// A new tool use block has started.
    ToolUseStart {
        /// Tool use identifier.
        id: String,
        /// Tool name.
        name: String,
    },
    /// A chunk of tool input JSON.
    InputJsonDelta(String),
    /// End-of-message metadata.
    MessageDelta {
        /// The stop reason.
        stop_reason: String,
    },
    /// Token usage reported for this message.
    MessageUsage {
        /// Input tokens consumed.
        input_tokens: u64,
        /// Output tokens generated.
        output_tokens: u64,
        /// Cache creation tokens.
        cache_creation_tokens: u64,
        /// Cache read tokens.
        cache_read_tokens: u64,
    },
    /// The message is complete.
    MessageStop,
    /// An error occurred during streaming.
    Error(String),
}

/// Accumulates [`StreamEvent`]s into a final [`ModelResponse`].
#[derive(Debug)]
pub struct StreamAccumulator {
    text: String,
    thinking: String,
    tool_json_parts: Vec<(String, String, String)>,
    stop_reason: String,
    usage: Usage,
    model: String,
}

impl StreamAccumulator {
    /// Create a new empty accumulator.
    pub fn new() -> Self {
        Self {
            text: String::new(),
            thinking: String::new(),
            tool_json_parts: Vec::new(),
            stop_reason: String::new(),
            usage: Usage::default(),
            model: String::new(),
        }
    }

    /// Feed a stream event into the accumulator.
    pub fn process(&mut self, event: &StreamEvent) {
        match event {
            StreamEvent::MessageStart { model } => {
                self.model = model.clone();
            }
            StreamEvent::TextDelta(delta) => {
                self.text.push_str(delta);
            }
            StreamEvent::ThinkingDelta(delta) => {
                self.thinking.push_str(delta);
            }
            StreamEvent::ToolUseStart { id, name } => {
                self.tool_json_parts
                    .push((id.clone(), name.clone(), String::new()));
            }
            StreamEvent::InputJsonDelta(delta) => {
                if let Some(last) = self.tool_json_parts.last_mut() {
                    last.2.push_str(delta);
                }
            }
            StreamEvent::MessageDelta { stop_reason } => {
                self.stop_reason = stop_reason.clone();
            }
            StreamEvent::MessageUsage {
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
            } => {
                self.usage.input_tokens = *input_tokens;
                self.usage.output_tokens = *output_tokens;
                self.usage.cache_creation_tokens = *cache_creation_tokens;
                self.usage.cache_read_tokens = *cache_read_tokens;
            }
            StreamEvent::MessageStop | StreamEvent::Error(_) => {}
        }
    }

    /// Consume the accumulator and produce a [`ModelResponse`].
    pub fn finish(self) -> ModelResponse {
        let tool_calls = self
            .tool_json_parts
            .into_iter()
            .map(|(id, name, json)| {
                let input = serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
                crate::types::ToolCall { id, name, input }
            })
            .collect();

        ModelResponse {
            text: self.text,
            thinking: self.thinking,
            tool_calls,
            stop_reason: StopReason::from_str(&self.stop_reason),
            usage: self.usage,
            model_used: self.model,
        }
    }
}

impl Default for StreamAccumulator {
    fn default() -> Self {
        Self::new()
    }
}
