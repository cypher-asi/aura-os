//! Shared automaton lifecycle runner.
//!
//! Provides [`start_and_connect`] and [`collect_automaton_events`] so both the
//! dev-loop task pipeline and the process executor can reuse the same
//! automaton start → event-stream → collection logic without duplication.

use std::time::Duration;
use tokio::sync::broadcast;
use tracing::warn;

use crate::{AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult};

/// Output collected from an automaton event stream.
#[derive(Debug, Clone, Default)]
pub struct CollectedOutput {
    pub output_text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub content_blocks: Vec<serde_json::Value>,
}

/// How the automaton event stream terminated.
#[derive(Debug)]
pub enum RunCompletion {
    /// Stream ended successfully (via `done` after optional `task_completed`).
    Done(CollectedOutput),
    /// Task or stream-level failure (`task_failed` or `error`).
    Failed {
        message: String,
        output: CollectedOutput,
    },
    /// Deadline exceeded before a terminal event.
    Timeout(CollectedOutput),
    /// The broadcast channel closed (harness disconnect).
    StreamClosed(CollectedOutput),
}

impl RunCompletion {
    /// Extract the collected output regardless of completion variant.
    pub fn into_output(self) -> CollectedOutput {
        match self {
            Self::Done(o)
            | Self::Failed { output: o, .. }
            | Self::Timeout(o)
            | Self::StreamClosed(o) => o,
        }
    }

    pub fn is_success(&self) -> bool {
        matches!(self, Self::Done(_))
    }
}

/// Errors from [`start_and_connect`].
#[derive(Debug, thiserror::Error)]
pub enum RunStartError {
    #[error("failed to start automaton: {0}")]
    Start(#[from] AutomatonStartError),
    #[error("failed to connect event stream after {attempts} attempt(s): {message}")]
    Connect { attempts: u32, message: String },
}

/// Start an automaton and connect to its event stream with retries.
///
/// `stream_retries` is the number of **additional** attempts after the first;
/// pass `0` for a single attempt, `2` for three total attempts, etc.
pub async fn start_and_connect(
    client: &AutomatonClient,
    params: AutomatonStartParams,
    stream_retries: u32,
) -> Result<(AutomatonStartResult, broadcast::Sender<serde_json::Value>), RunStartError> {
    let result = client.start(params).await?;
    let tx = connect_with_retries(
        client,
        &result.automaton_id,
        &result.event_stream_url,
        stream_retries,
    )
    .await
    .map_err(|message| RunStartError::Connect {
        attempts: stream_retries + 1,
        message,
    })?;
    Ok((result, tx))
}

/// Connect to an automaton event stream, retrying on failure.
///
/// `retries` is the number of **additional** attempts after the first.
pub async fn connect_with_retries(
    client: &AutomatonClient,
    automaton_id: &str,
    event_stream_url: &str,
    retries: u32,
) -> Result<broadcast::Sender<serde_json::Value>, String> {
    let total_attempts = retries + 1;
    let mut last_err = String::new();
    for attempt in 0..total_attempts {
        if attempt > 0 {
            let delay = Duration::from_millis(500 * (1u64 << attempt.min(2)));
            warn!(
                %automaton_id, attempt,
                "Retrying event stream connection in {}ms", delay.as_millis()
            );
            tokio::time::sleep(delay).await;
        }
        match client
            .connect_event_stream(automaton_id, Some(event_stream_url))
            .await
        {
            Ok(tx) => return Ok(tx),
            Err(e) => {
                warn!(
                    %automaton_id, attempt,
                    error = %e, "Event stream connection attempt failed"
                );
                last_err = e.to_string();
            }
        }
    }
    Err(last_err)
}

/// Consume events from an automaton broadcast channel, collecting output,
/// token usage, and content blocks.
///
/// `on_event` fires for each raw event before collection, letting callers
/// forward or enrich events (e.g. stamping process or task metadata).
pub async fn collect_automaton_events<F>(
    mut rx: broadcast::Receiver<serde_json::Value>,
    timeout: Duration,
    mut on_event: F,
) -> RunCompletion
where
    F: FnMut(&serde_json::Value, &str),
{
    let mut out = CollectedOutput::default();
    let mut pending_text = String::new();
    let mut failed_message: Option<String> = None;
    let deadline = tokio::time::Instant::now() + timeout;
    let flush_pending_text = |out: &mut CollectedOutput, pending_text: &mut String| {
        if pending_text.is_empty() {
            return;
        }
        let text = std::mem::take(pending_text);
        out.content_blocks.push(serde_json::json!({
            "type": "text",
            "text": text,
        }));
    };

    let finish = |out: CollectedOutput, failed_message: Option<String>| -> RunCompletion {
        if let Some(msg) = failed_message {
            RunCompletion::Failed {
                message: msg,
                output: out,
            }
        } else {
            RunCompletion::Done(out)
        }
    };

    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(evt)) => {
                let evt_type = evt.get("type").and_then(|t| t.as_str()).unwrap_or("");
                on_event(&evt, evt_type);
                match evt_type {
                    "text_delta" => {
                        let text = evt
                            .get("text")
                            .or_else(|| evt.get("delta"))
                            .and_then(|t| t.as_str());
                        if let Some(text) = text {
                            out.output_text.push_str(text);
                            pending_text.push_str(text);
                        }
                    }
                    "tool_use_start" | "tool_call_started" => {
                        flush_pending_text(&mut out, &mut pending_text);
                        let id = evt.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = evt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        out.content_blocks.push(serde_json::json!({
                            "type": "tool_use", "id": id, "name": name,
                            "input": serde_json::Value::Null,
                        }));
                    }
                    "tool_call_snapshot" => {
                        let id = evt.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = evt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let input = evt
                            .get("input")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({}));
                        if let Some(block) = out.content_blocks.iter_mut().rev().find(|block| {
                            block.get("type").and_then(|v| v.as_str()) == Some("tool_use")
                                && block.get("id").and_then(|v| v.as_str()) == Some(id)
                        }) {
                            block["name"] = serde_json::Value::String(name.to_string());
                            block["input"] = input;
                        } else {
                            out.content_blocks.push(serde_json::json!({
                                "type": "tool_use",
                                "id": id,
                                "name": name,
                                "input": input,
                            }));
                        }
                    }
                    "tool_result" => {
                        let tool_use_id = evt
                            .get("tool_use_id")
                            .or_else(|| evt.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let name = evt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let result_text = evt.get("result").and_then(|v| v.as_str()).unwrap_or("");
                        let is_error = evt
                            .get("is_error")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        out.content_blocks.push(serde_json::json!({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "name": name,
                            "result": result_text,
                            "is_error": is_error,
                        }));
                    }
                    "assistant_message_end" | "token_usage" | "usage" | "session_usage" => {
                        let usage = evt.get("usage").unwrap_or(&evt);
                        if let Some(cum_in) = usage
                            .get("cumulative_input_tokens")
                            .and_then(|v| v.as_u64())
                        {
                            out.input_tokens = cum_in;
                        } else if let Some(inp) = usage.get("input_tokens").and_then(|v| v.as_u64())
                        {
                            out.input_tokens += inp;
                        }
                        if let Some(cum_out) = usage
                            .get("cumulative_output_tokens")
                            .and_then(|v| v.as_u64())
                        {
                            out.output_tokens = cum_out;
                        } else if let Some(outp) =
                            usage.get("output_tokens").and_then(|v| v.as_u64())
                        {
                            out.output_tokens += outp;
                        }
                        if let Some(m) = usage.get("model").and_then(|v| v.as_str()) {
                            out.model = Some(m.to_string());
                        }
                    }
                    "task_completed" => {
                        flush_pending_text(&mut out, &mut pending_text);
                    }
                    "task_failed" => {
                        flush_pending_text(&mut out, &mut pending_text);
                        let msg = evt
                            .get("reason")
                            .or_else(|| evt.get("message"))
                            .or_else(|| evt.get("error"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "Automaton execution failed".into());
                        failed_message = Some(msg);
                    }
                    "done" => {
                        flush_pending_text(&mut out, &mut pending_text);
                        return finish(out, failed_message);
                    }
                    "error" => {
                        flush_pending_text(&mut out, &mut pending_text);
                        let msg = evt
                            .get("message")
                            .or_else(|| evt.get("error"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "Automaton execution failed".into());
                        return RunCompletion::Failed {
                            message: msg,
                            output: out,
                        };
                    }
                    _ => {}
                }
            }
            Ok(Err(broadcast::error::RecvError::Closed)) => {
                flush_pending_text(&mut out, &mut pending_text);
                return finish(out, failed_message);
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Err(_) => {
                flush_pending_text(&mut out, &mut pending_text);
                return RunCompletion::Timeout(out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{collect_automaton_events, RunCompletion};
    use std::time::Duration;
    use tokio::sync::broadcast;

    #[tokio::test]
    async fn collect_automaton_events_merges_tool_snapshots() {
        let (tx, rx) = broadcast::channel(16);

        tx.send(serde_json::json!({
            "type": "tool_use_start",
            "id": "tool-1",
            "name": "write_file",
        }))
        .unwrap();
        tx.send(serde_json::json!({
            "type": "tool_call_snapshot",
            "id": "tool-1",
            "name": "write_file",
            "input": {
                "path": "notes.txt",
                "content": "hello"
            },
        }))
        .unwrap();
        tx.send(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "name": "write_file",
            "result": "ok",
            "is_error": false,
        }))
        .unwrap();
        tx.send(serde_json::json!({ "type": "done" })).unwrap();

        let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;
        let output = match completion {
            RunCompletion::Done(output) => output,
            other => panic!("expected completed output, got {other:?}"),
        };

        assert_eq!(output.content_blocks.len(), 2);
        assert_eq!(output.content_blocks[0]["type"], "tool_use");
        assert_eq!(output.content_blocks[0]["input"]["path"], "notes.txt");
        assert_eq!(output.content_blocks[0]["input"]["content"], "hello");
    }
}
