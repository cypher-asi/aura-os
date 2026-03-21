use tokio::sync::mpsc;
use tracing::{error, info, warn};

use aura_claude::{ClaudeStreamEvent, ToolCall, ToolStreamResponse};
use aura_billing::{MeteredLlmError, MeteredStreamRequest};

use crate::chat_sanitize;
use crate::tool_loop_types::*;
use crate::channel_ext::send_or_log;
use crate::tool_loop::{LoopState, append_text};

pub(crate) enum IterationOutcome {
    EarlyReturn(ToolLoopResult),
    Completed(IterationCompleted),
}

pub(crate) struct IterationCompleted {
    pub(crate) iter_text: String,
    pub(crate) iter_tool_calls: Vec<ToolCall>,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) stop_reason: String,
    pub(crate) model_used: String,
}

pub(crate) async fn run_single_iteration(
    ctx: &IterationContext<'_>,
    state: &mut LoopState,
    iteration: usize,
) -> IterationOutcome {
    info!(
        iteration,
        message_count = state.api_messages.len(),
        timeout_secs = ctx.config.stream_timeout.as_secs(),
        "llm_iteration start"
    );

    let repaired = chat_sanitize::validate_and_repair_messages(state.api_messages.clone());
    if repaired.len() != state.api_messages.len() {
        info!(
            before = state.api_messages.len(),
            after = repaired.len(),
            "Pre-send validation repaired message history"
        );
    }
    state.api_messages = repaired;

    let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

    let llm_clone = ctx.llm.clone();
    let api_key_owned = ctx.api_key.to_string();
    let system_owned = ctx.system_prompt.to_string();
    let msgs_owned = state.api_messages.clone();
    let tools_owned = ctx.tools.to_vec();
    let max_tokens = ctx.config.max_tokens;
    let thinking = ctx.config.thinking.clone();
    let reason = ctx.config.billing_reason;

    let model_override = ctx.config.model_override.clone();
    let stream_handle = tokio::spawn(async move {
        llm_clone
            .complete_stream_with_tools(MeteredStreamRequest {
                api_key: &api_key_owned,
                system_prompt: &system_owned,
                messages: msgs_owned,
                tools: tools_owned,
                max_tokens,
                thinking,
                event_tx: claude_tx,
                model_override: model_override.as_deref(),
                billing_reason: reason,
                metadata: None,
            })
            .await
    });

    let mut iter_text = String::new();
    let mut iter_tool_calls: Vec<ToolCall> = Vec::new();
    let mut stream_error_forwarded = false;

    let iter_timed_out = loop {
        match tokio::time::timeout(ctx.config.stream_timeout, claude_rx.recv()).await {
            Ok(Some(evt)) => match evt {
                ClaudeStreamEvent::Delta(text) => {
                    iter_text.push_str(&text);
                    send_or_log(ctx.event_tx, ToolLoopEvent::Delta(text));
                }
                ClaudeStreamEvent::ToolUseStarted { id, name } => {
                    send_or_log(ctx.event_tx, ToolLoopEvent::ToolUseStarted {
                        id: id.clone(),
                        name: name.clone(),
                    });
                }
                ClaudeStreamEvent::ToolUse { id, name, input } => {
                    send_or_log(ctx.event_tx, ToolLoopEvent::ToolUseDetected {
                        id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    });
                    iter_tool_calls.push(ToolCall { id, name, input });
                }
                ClaudeStreamEvent::ThinkingDelta(text) => {
                    state.total_thinking.push_str(&text);
                    send_or_log(ctx.event_tx, ToolLoopEvent::ThinkingDelta(text));
                }
                ClaudeStreamEvent::Done { stop_reason, .. } => {
                    info!(iteration, stop_reason = %stop_reason, tool_calls = iter_tool_calls.len(), "Tool loop iteration done");
                }
                ClaudeStreamEvent::Error(msg) => {
                    send_or_log(ctx.event_tx, ToolLoopEvent::Error(msg));
                    stream_error_forwarded = true;
                }
            },
            Ok(None) => break false,
            Err(_) => {
                warn!(iteration, "Tool loop streaming timed out after {}s", ctx.config.stream_timeout.as_secs());
                stream_handle.abort();
                break true;
            }
        }
    };

    if iter_timed_out {
        send_or_log(ctx.event_tx, ToolLoopEvent::Error("LLM streaming timed out".to_string()));
        append_text(&mut state.total_text, &iter_text);
        return IterationOutcome::EarlyReturn(state.build_result(iteration + 1, true, false, None));
    }

    handle_stream_result(
        stream_handle, iter_text, iter_tool_calls,
        stream_error_forwarded, ctx.event_tx, state, iteration,
    )
    .await
}

pub(crate) async fn handle_stream_result(
    stream_handle: tokio::task::JoinHandle<Result<ToolStreamResponse, MeteredLlmError>>,
    iter_text: String,
    iter_tool_calls: Vec<ToolCall>,
    stream_error_forwarded: bool,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
    iteration: usize,
) -> IterationOutcome {
    let stream_result = match stream_handle.await {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            error!(iteration, error = %e, "LLM streaming failed");
            let is_billing = e.is_billing_error();
            let error_msg = format!("{e}");
            if !stream_error_forwarded {
                if e.is_insufficient_credits() {
                    send_or_log(event_tx, ToolLoopEvent::Error(
                        "Insufficient credits — please top up to continue.".to_string(),
                    ));
                } else if is_billing {
                    send_or_log(event_tx, ToolLoopEvent::Error(
                        format!("Billing error — stopping to prevent unbilled usage: {e}"),
                    ));
                } else if iter_text.is_empty() && iter_tool_calls.is_empty() {
                    send_or_log(event_tx, ToolLoopEvent::Error(error_msg.clone()));
                }
            }
            append_text(&mut state.total_text, &iter_text);
            let llm_error = if is_billing { None } else { Some(error_msg) };
            return IterationOutcome::EarlyReturn(
                state.build_result(iteration + 1, false, is_billing, llm_error),
            );
        }
        Err(e) => {
            error!(iteration, error = %e, "Stream task panicked or was cancelled");
            let error_msg = format!("Stream task error: {e}");
            if iter_text.is_empty() && iter_tool_calls.is_empty() {
                send_or_log(event_tx, ToolLoopEvent::Error(error_msg.clone()));
            }
            append_text(&mut state.total_text, &iter_text);
            return IterationOutcome::EarlyReturn(
                state.build_result(iteration + 1, false, false, Some(error_msg)),
            );
        }
    };

    IterationOutcome::Completed(IterationCompleted {
        iter_text,
        iter_tool_calls,
        input_tokens: stream_result.input_tokens,
        output_tokens: stream_result.output_tokens,
        stop_reason: stream_result.stop_reason,
        model_used: stream_result.model_used,
    })
}
