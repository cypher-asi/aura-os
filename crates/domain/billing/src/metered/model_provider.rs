//! [`ModelProvider`] implementation for [`MeteredLlm`].
//!
//! Wraps the underlying `LlmProvider` with billing pre-flight checks and
//! post-call credit debits, exposing the provider-agnostic interface.

use std::sync::atomic::Ordering;

use async_trait::async_trait;
use tokio::sync::mpsc;

use aura_provider::{
    ModelProvider, ModelRequest, ModelResponse, ProviderError, StreamEvent, StreamEventStream,
};

use super::debit::DebitParams;
use super::{MeteredLlm, MeteredLlmError};

impl MeteredLlm {
    fn map_metered_err(e: MeteredLlmError) -> ProviderError {
        match e {
            MeteredLlmError::InsufficientCredits => ProviderError::InsufficientCredits,
            MeteredLlmError::Llm(inner) => ProviderError::from(inner),
            MeteredLlmError::Billing(be) => ProviderError::Api {
                status: 500,
                message: format!("billing: {be}"),
            },
        }
    }

    fn handle_provider_result<T>(
        &self,
        result: Result<T, aura_claude::ClaudeClientError>,
    ) -> Result<T, ProviderError> {
        match result {
            Ok(v) => Ok(v),
            Err(aura_claude::ClaudeClientError::InsufficientCredits) => {
                self.credits_exhausted.store(true, Ordering::SeqCst);
                Err(ProviderError::InsufficientCredits)
            }
            Err(e) => Err(Self::map_metered_err(MeteredLlmError::Llm(e))),
        }
    }
}

#[async_trait]
impl ModelProvider for MeteredLlm {
    fn name(&self) -> &'static str {
        "metered"
    }

    async fn complete(&self, request: ModelRequest) -> Result<ModelResponse, ProviderError> {
        let credential = self
            .resolve_credential(&request.api_key)
            .map_err(Self::map_metered_err)?;
        let model_str = request.model.clone();

        let estimated_input = aura_provider::estimate_tokens(&request.system_prompt)
            + request
                .messages
                .iter()
                .map(aura_provider::estimate_message_tokens)
                .sum::<u64>();

        let (event_tx, _rx) = mpsc::unbounded_channel();
        let messages: Vec<aura_claude::RichMessage> = request
            .messages
            .into_iter()
            .map(provider_msg_to_rich)
            .collect();
        let tools: Vec<aura_claude::ToolDefinition> = request
            .tools
            .into_iter()
            .map(provider_tool_to_claude)
            .collect();

        if self.router_mode {
            let result = self
                .provider
                .complete_stream_with_tools(aura_claude::ToolStreamRequest {
                    api_key: &credential,
                    system_prompt: &request.system_prompt,
                    messages,
                    tools,
                    max_tokens: request.max_tokens,
                    thinking: request.thinking.map(|tc| aura_claude::ThinkingConfig {
                        thinking_type: tc.thinking_type,
                        budget_tokens: tc.budget_tokens,
                    }),
                    event_tx,
                    model_override: Some(&model_str),
                })
                .await;
            let resp = self.handle_provider_result(result)?;
            return Ok(claude_resp_to_model(resp));
        }

        let estimated_credits = self.estimate_credits(&model_str, estimated_input, 0);
        self.pre_flight_check_for(estimated_credits)
            .await
            .map_err(Self::map_metered_err)?;

        let resp = self
            .provider
            .complete_stream_with_tools(aura_claude::ToolStreamRequest {
                api_key: &request.api_key,
                system_prompt: &request.system_prompt,
                messages,
                tools,
                max_tokens: request.max_tokens,
                thinking: request.thinking.map(|tc| aura_claude::ThinkingConfig {
                    thinking_type: tc.thinking_type,
                    budget_tokens: tc.budget_tokens,
                }),
                event_tx,
                model_override: Some(&model_str),
            })
            .await
            .map_err(|e| Self::map_metered_err(MeteredLlmError::Llm(e)))?;

        let billing_model = if resp.model_used.is_empty() {
            aura_claude::DEFAULT_MODEL
        } else {
            &resp.model_used
        };
        self.debit(DebitParams {
            model: billing_model,
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_input_tokens: resp.cache_creation_input_tokens,
            cache_read_input_tokens: resp.cache_read_input_tokens,
            reason: "model_provider",
            metadata: None,
        })
        .await
        .map_err(Self::map_metered_err)?;

        Ok(claude_resp_to_model(resp))
    }

    async fn complete_streaming(
        &self,
        request: ModelRequest,
    ) -> Result<StreamEventStream, ProviderError> {
        let _resp = <Self as ModelProvider>::complete(self, request).await?;
        let events = vec![StreamEvent::MessageStop];
        let stream = futures_util::stream::iter(events);
        Ok(Box::pin(stream))
    }
}

fn claude_resp_to_model(resp: aura_claude::ToolStreamResponse) -> ModelResponse {
    ModelResponse {
        text: resp.text,
        thinking: String::new(),
        tool_calls: resp
            .tool_calls
            .into_iter()
            .map(|tc| aura_provider::ToolCall {
                id: tc.id,
                name: tc.name,
                input: tc.input,
            })
            .collect(),
        stop_reason: aura_provider::StopReason::from_str(&resp.stop_reason),
        usage: aura_provider::Usage {
            input_tokens: resp.input_tokens,
            output_tokens: resp.output_tokens,
            cache_creation_tokens: resp.cache_creation_input_tokens,
            cache_read_tokens: resp.cache_read_input_tokens,
        },
        model_used: resp.model_used,
    }
}

fn provider_msg_to_rich(msg: aura_provider::Message) -> aura_claude::RichMessage {
    let role = match msg.role {
        aura_provider::Role::User => "user",
        aura_provider::Role::Assistant => "assistant",
    };
    let content = match msg.content {
        aura_provider::MessageContent::Text(t) => aura_claude::MessageContent::Text(t),
        aura_provider::MessageContent::Blocks(blocks) => aura_claude::MessageContent::Blocks(
            blocks.into_iter().map(provider_block_to_claude).collect(),
        ),
    };
    aura_claude::RichMessage {
        role: role.to_string(),
        content,
    }
}

fn provider_block_to_claude(block: aura_provider::ContentBlock) -> aura_claude::ContentBlock {
    match block {
        aura_provider::ContentBlock::Text { text } => aura_claude::ContentBlock::Text { text },
        aura_provider::ContentBlock::Image { source } => aura_claude::ContentBlock::Image {
            source: aura_claude::ImageSource {
                source_type: source.source_type,
                media_type: source.media_type,
                data: source.data,
            },
        },
        aura_provider::ContentBlock::ToolUse { id, name, input } => {
            aura_claude::ContentBlock::ToolUse { id, name, input }
        }
        aura_provider::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => aura_claude::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        },
    }
}

fn provider_tool_to_claude(td: aura_provider::ToolDefinition) -> aura_claude::ToolDefinition {
    aura_claude::ToolDefinition {
        name: td.name,
        description: td.description,
        input_schema: td.input_schema,
        cache_control: td.cache_control.map(|cc| aura_claude::CacheControl {
            cache_type: cc.cache_type,
        }),
    }
}
