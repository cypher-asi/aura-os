//! Shared automaton lifecycle runner.
//!
//! Provides [`start_and_connect`] and [`collect_automaton_events`] so both the
//! dev-loop task pipeline and the process executor can reuse the same
//! automaton start → event-stream → collection logic without duplication.

pub mod automaton_event_kinds;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::warn;

use automaton_event_kinds::{
    is_usage_totals_event, DONE, ERROR, TASK_COMPLETED, TASK_FAILED, TEXT_DELTA,
    TOOL_CALL_COMPLETED, TOOL_CALL_SNAPSHOT, TOOL_CALL_STARTED, TOOL_RESULT, TOOL_USE_START,
};

pub use automaton_event_kinds::{
    is_git_sync_event, is_process_progress_broadcast_event, is_process_stream_forward_event,
    normalize_process_tool_type_field,
};

use crate::{AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult};

const MAX_COLLECTED_OUTPUT_TEXT_CHARS: usize = 16_000;
const MAX_COLLECTED_TEXT_BLOCK_CHARS: usize = 4_000;
const MAX_COLLECTED_TOOL_RESULT_CHARS: usize = 8_000;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitSyncMilestone {
    pub event_type: String,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub push_id: Option<String>,
    pub reason: Option<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub commits: Vec<String>,
}

fn truncate_with_marker(input: &str, limit: usize) -> String {
    if input.chars().count() <= limit {
        return input.to_string();
    }

    force_truncate_with_marker(input, limit)
}

fn force_truncate_with_marker(input: &str, limit: usize) -> String {
    let truncated: String = input.chars().take(limit).collect();
    format!("{truncated}\n[truncated]")
}

fn append_truncated(buf: &mut String, text: &str, limit: usize) {
    if buf.ends_with("\n[truncated]") || limit == 0 {
        return;
    }

    let current_len = buf.chars().count();
    if current_len >= limit {
        *buf = force_truncate_with_marker(buf, limit);
        return;
    }

    let remaining = limit - current_len;
    let mut chars = text.chars();
    let chunk: String = chars.by_ref().take(remaining).collect();
    buf.push_str(&chunk);
    if chars.next().is_some() {
        *buf = force_truncate_with_marker(buf, limit);
    }
}

fn first_string<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
}

fn extract_summary(value: &serde_json::Value) -> Option<String> {
    first_string(value, &["summary", "completion_summary", "message"])
        .map(str::to_owned)
        .or_else(|| {
            ["milestone", "sync", "git", "commit", "push"]
                .into_iter()
                .find_map(|key| value.get(key).and_then(extract_summary))
        })
}

fn extract_commit_list(value: &serde_json::Value) -> Vec<String> {
    value
        .get("commits")
        .or_else(|| value.get("commit_ids"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| match entry {
            serde_json::Value::String(sha) => Some(sha.clone()),
            serde_json::Value::Object(map) => map
                .get("sha")
                .or_else(|| map.get("commit_sha"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            _ => None,
        })
        .collect()
}

fn extract_git_milestone_from_value(
    value: &serde_json::Value,
    event_type: Option<&str>,
) -> Option<GitSyncMilestone> {
    let event_type = event_type
        .filter(|evt_type| is_git_sync_event(evt_type))
        .or_else(|| {
            first_string(value, &["event_type", "kind", "type"])
                .filter(|evt_type| is_git_sync_event(evt_type))
        })?;

    Some(GitSyncMilestone {
        event_type: event_type.to_string(),
        commit_sha: first_string(value, &["commit_sha", "sha"]).map(str::to_owned),
        branch: first_string(value, &["branch"]).map(str::to_owned),
        remote: first_string(value, &["remote"]).map(str::to_owned),
        push_id: first_string(value, &["push_id"]).map(str::to_owned),
        reason: first_string(value, &["reason", "error"]).map(str::to_owned),
        summary: extract_summary(value),
        commits: extract_commit_list(value),
    })
}

fn extract_git_milestones(event: &serde_json::Value, event_type: &str) -> Vec<GitSyncMilestone> {
    let mut milestones = Vec::new();
    if let Some(milestone) = extract_git_milestone_from_value(event, Some(event_type)) {
        milestones.push(milestone);
    }
    for key in ["milestone", "sync", "git", "commit", "push"] {
        if let Some(value) = event.get(key) {
            if let Some(milestone) = extract_git_milestone_from_value(value, None) {
                milestones.push(milestone);
            }
        }
    }
    milestones
}

/// Output collected from an automaton event stream.
#[derive(Debug, Clone, Default)]
pub struct CollectedOutput {
    pub output_text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub completion_summary: Option<String>,
    pub git_milestones: Vec<GitSyncMilestone>,
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
        Some(&result.event_stream_url),
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
/// Passing `None` for `event_stream_url` lets the client fall back to its
/// default stream path — used when adopting an existing automaton whose
/// start-time URL is no longer available (e.g. after recovering from a
/// `Conflict` on restart).
pub async fn connect_with_retries(
    client: &AutomatonClient,
    automaton_id: &str,
    event_stream_url: Option<&str>,
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
            .connect_event_stream(automaton_id, event_stream_url)
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
        let text = truncate_with_marker(
            &std::mem::take(pending_text),
            MAX_COLLECTED_TEXT_BLOCK_CHARS,
        );
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
                if out.completion_summary.is_none() {
                    out.completion_summary = extract_summary(&evt);
                }
                for milestone in extract_git_milestones(&evt, evt_type) {
                    if !out
                        .git_milestones
                        .iter()
                        .any(|existing| existing == &milestone)
                    {
                        out.git_milestones.push(milestone);
                    }
                }
                match evt_type {
                    TEXT_DELTA => {
                        let text = evt
                            .get("text")
                            .or_else(|| evt.get("delta"))
                            .and_then(|t| t.as_str());
                        if let Some(text) = text {
                            append_truncated(
                                &mut out.output_text,
                                text,
                                MAX_COLLECTED_OUTPUT_TEXT_CHARS,
                            );
                            append_truncated(
                                &mut pending_text,
                                text,
                                MAX_COLLECTED_TEXT_BLOCK_CHARS,
                            );
                        }
                    }
                    TOOL_USE_START | TOOL_CALL_STARTED => {
                        flush_pending_text(&mut out, &mut pending_text);
                        let id = evt.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = evt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        out.content_blocks.push(serde_json::json!({
                            "type": "tool_use", "id": id, "name": name,
                            "input": serde_json::Value::Null,
                        }));
                    }
                    TOOL_CALL_SNAPSHOT | TOOL_CALL_COMPLETED => {
                        // `tool_call_completed` carries the authoritative
                        // (non-partial) input and supersedes any earlier
                        // `tool_call_snapshot` for the same id. Both
                        // frames use the same upsert logic: find the
                        // matching `tool_use` block by id and overwrite
                        // its name/input, or push a new one when the
                        // stream skipped the start event.
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
                    TOOL_RESULT => {
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
                            "result": truncate_with_marker(
                                result_text,
                                MAX_COLLECTED_TOOL_RESULT_CHARS,
                            ),
                            "is_error": is_error,
                        }));
                    }
                    ty if is_usage_totals_event(ty) => {
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
                    TASK_COMPLETED => {
                        flush_pending_text(&mut out, &mut pending_text);
                    }
                    TASK_FAILED => {
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
                    DONE => {
                        flush_pending_text(&mut out, &mut pending_text);
                        return finish(out, failed_message);
                    }
                    ERROR => {
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

    #[tokio::test]
    async fn collect_automaton_events_truncates_large_text_output() {
        let (tx, rx) = broadcast::channel(16);
        tx.send(serde_json::json!({
            "type": "text_delta",
            "text": "x".repeat(20_000),
        }))
        .unwrap();
        tx.send(serde_json::json!({ "type": "done" })).unwrap();

        let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;
        let output = match completion {
            RunCompletion::Done(output) => output,
            other => panic!("expected completed output, got {other:?}"),
        };

        assert!(output.output_text.ends_with("\n[truncated]"));
        assert_eq!(output.output_text.chars().count(), 16_012);
        assert_eq!(output.content_blocks[0]["type"], "text");
        assert!(output.content_blocks[0]["text"]
            .as_str()
            .unwrap_or_default()
            .ends_with("\n[truncated]"));
    }

    #[tokio::test]
    async fn collect_automaton_events_truncates_large_tool_result() {
        let (tx, rx) = broadcast::channel(16);
        tx.send(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "name": "search",
            "result": "y".repeat(9_000),
            "is_error": false,
        }))
        .unwrap();
        tx.send(serde_json::json!({ "type": "done" })).unwrap();

        let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;
        let output = match completion {
            RunCompletion::Done(output) => output,
            other => panic!("expected completed output, got {other:?}"),
        };

        let result = output.content_blocks[0]["result"]
            .as_str()
            .unwrap_or_default();
        assert!(result.ends_with("\n[truncated]"));
        assert_eq!(result.chars().count(), 8_012);
    }

    #[tokio::test]
    async fn collect_automaton_events_captures_git_sync_milestones() {
        let (tx, rx) = broadcast::channel(16);
        tx.send(serde_json::json!({
            "type": "task_completed",
            "summary": "Committed and pushed changes",
            "sync": {
                "event_type": "git_pushed",
                "commit_sha": "abc12345",
                "branch": "main",
                "remote": "origin",
                "push_id": "push-1",
                "commits": ["abc12345"],
            }
        }))
        .unwrap();
        tx.send(serde_json::json!({ "type": "done" })).unwrap();

        let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;
        let output = match completion {
            RunCompletion::Done(output) => output,
            other => panic!("expected completed output, got {other:?}"),
        };

        assert_eq!(
            output.completion_summary.as_deref(),
            Some("Committed and pushed changes")
        );
        assert_eq!(output.git_milestones.len(), 1);
        assert_eq!(
            output.git_milestones[0],
            super::GitSyncMilestone {
                event_type: "git_pushed".to_string(),
                commit_sha: Some("abc12345".to_string()),
                branch: Some("main".to_string()),
                remote: Some("origin".to_string()),
                push_id: Some("push-1".to_string()),
                reason: None,
                summary: None,
                commits: vec!["abc12345".to_string()],
            }
        );
    }

    #[tokio::test]
    async fn collect_automaton_events_captures_flat_git_failure() {
        let (tx, rx) = broadcast::channel(16);
        tx.send(serde_json::json!({
            "type": "git_push_failed",
            "reason": "timed out",
            "branch": "main",
            "remote": "origin",
        }))
        .unwrap();
        tx.send(serde_json::json!({ "type": "done" })).unwrap();

        let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;
        let output = match completion {
            RunCompletion::Done(output) => output,
            other => panic!("expected completed output, got {other:?}"),
        };

        assert_eq!(output.git_milestones.len(), 1);
        assert_eq!(output.git_milestones[0].event_type, "git_push_failed");
        assert_eq!(
            output.git_milestones[0].reason.as_deref(),
            Some("timed out")
        );
        assert_eq!(output.git_milestones[0].branch.as_deref(), Some("main"));
    }
}
