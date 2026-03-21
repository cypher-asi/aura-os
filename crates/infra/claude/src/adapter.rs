//! [`ModelProvider`] implementation for [`ClaudeClient`].
//!
//! This bridges the provider-agnostic `ModelProvider` trait from `aura-provider`
//! to the Claude-specific `LlmProvider` machinery, keeping the existing
//! channel-based streaming architecture intact.

use async_trait::async_trait;
use futures_util::StreamExt;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;

use aura_provider::{
    ModelProvider, ModelRequest, ModelResponse, ProviderError, StreamEvent, StreamEventStream,
};

use crate::types::{ClaudeStreamEvent, ToolStreamRequest};
use crate::ClaudeClient;

/// Map a single Claude stream event to zero or more provider-agnostic events.
///
/// `Done` fans out into `MessageUsage` + `MessageDelta` + `MessageStop` so
/// consumers see the full lifecycle.
fn map_claude_event(event: ClaudeStreamEvent) -> Vec<StreamEvent> {
    match event {
        ClaudeStreamEvent::Delta(text) => vec![StreamEvent::TextDelta(text)],
        ClaudeStreamEvent::ThinkingDelta(text) => vec![StreamEvent::ThinkingDelta(text)],
        ClaudeStreamEvent::ToolUseStarted { id, name } => {
            vec![StreamEvent::ToolUseStart { id, name }]
        }
        // The completed ToolUse is already captured in the ToolStreamResponse;
        // streaming consumers rely on ToolUseStart + InputJsonDelta instead.
        ClaudeStreamEvent::ToolUse { .. } => vec![],
        ClaudeStreamEvent::Done {
            stop_reason,
            input_tokens,
            output_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
        } => vec![
            StreamEvent::MessageUsage {
                input_tokens,
                output_tokens,
                cache_creation_tokens: cache_creation_input_tokens,
                cache_read_tokens: cache_read_input_tokens,
            },
            StreamEvent::MessageDelta { stop_reason },
            StreamEvent::MessageStop,
        ],
        ClaudeStreamEvent::Error(msg) => vec![StreamEvent::Error(msg)],
    }
}

#[async_trait]
impl ModelProvider for ClaudeClient {
    fn name(&self) -> &'static str {
        "claude"
    }

    async fn complete(&self, request: ModelRequest) -> Result<ModelResponse, ProviderError> {
        let (event_tx, _rx) = mpsc::unbounded_channel();
        let model = request.model.clone();
        let wire_req = ToolStreamRequest {
            api_key: &request.api_key,
            system_prompt: &request.system_prompt,
            messages: request.messages.into_iter().map(Into::into).collect(),
            tools: request.tools.into_iter().map(Into::into).collect(),
            max_tokens: request.max_tokens,
            thinking: request.thinking.map(Into::into),
            event_tx,
            model_override: Some(&model),
        };
        let resp = crate::LlmProvider::complete_stream_with_tools(self, wire_req)
            .await
            .map_err(ProviderError::from)?;
        Ok(resp.into())
    }

    async fn complete_streaming(
        &self,
        request: ModelRequest,
    ) -> Result<StreamEventStream, ProviderError> {
        // Events are pushed to the channel in real-time during SSE parsing.
        // `complete_stream_with_tools` returns only after the stream ends, so
        // by this point all events are buffered in the receiver.  Wrapping
        // the receiver as a Stream lets callers consume them idiomatically.
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let model = request.model.clone();
        let wire_req = ToolStreamRequest {
            api_key: &request.api_key,
            system_prompt: &request.system_prompt,
            messages: request.messages.into_iter().map(Into::into).collect(),
            tools: request.tools.into_iter().map(Into::into).collect(),
            max_tokens: request.max_tokens,
            thinking: request.thinking.map(Into::into),
            event_tx,
            model_override: Some(&model),
        };
        crate::LlmProvider::complete_stream_with_tools(self, wire_req)
            .await
            .map_err(ProviderError::from)?;

        let stream = UnboundedReceiverStream::new(event_rx)
            .flat_map(|evt| futures_util::stream::iter(map_claude_event(evt)));
        Ok(Box::pin(stream))
    }
}
