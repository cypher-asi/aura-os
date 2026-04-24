use std::time::Duration;

use tokio::sync::broadcast;

use super::automaton_event_kinds::{
    is_git_sync_event, is_usage_totals_event, DONE, ERROR, TASK_COMPLETED, TASK_FAILED, TEXT_DELTA,
    TOOL_CALL_COMPLETED, TOOL_CALL_SNAPSHOT, TOOL_CALL_STARTED, TOOL_RESULT, TOOL_USE_START,
};
use super::GitSyncMilestone;

const MAX_COLLECTED_OUTPUT_TEXT_CHARS: usize = 16_000;
const MAX_COLLECTED_TEXT_BLOCK_CHARS: usize = 4_000;
const MAX_COLLECTED_TOOL_RESULT_CHARS: usize = 8_000;

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
    let deadline = tokio::time::Instant::now() + timeout;
    let mut state = CollectorState::default();

    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(evt)) => {
                let evt_type = evt.get("type").and_then(|t| t.as_str()).unwrap_or("");
                on_event(&evt, evt_type);
                if let Some(completion) = state.apply_event(&evt, evt_type) {
                    return completion;
                }
            }
            Ok(Err(broadcast::error::RecvError::Closed)) => return state.finish(),
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Err(_) => return state.timeout(),
        }
    }
}

#[derive(Default)]
struct CollectorState {
    out: CollectedOutput,
    pending_text: String,
    failed_message: Option<String>,
}

impl CollectorState {
    fn apply_event(&mut self, evt: &serde_json::Value, evt_type: &str) -> Option<RunCompletion> {
        self.capture_summary(evt);
        self.capture_git_milestones(evt, evt_type);
        match evt_type {
            TEXT_DELTA => self.capture_text_delta(evt),
            TOOL_USE_START | TOOL_CALL_STARTED => self.push_tool_start(evt),
            TOOL_CALL_SNAPSHOT | TOOL_CALL_COMPLETED => self.upsert_tool_call(evt),
            TOOL_RESULT => self.push_tool_result(evt),
            ty if is_usage_totals_event(ty) => self.capture_usage(evt),
            TASK_COMPLETED => self.flush_pending_text(),
            TASK_FAILED => self.capture_task_failure(evt),
            DONE => return Some(std::mem::take(self).finish()),
            ERROR => return Some(std::mem::take(self).error(evt)),
            _ => {}
        }
        None
    }

    fn finish(mut self) -> RunCompletion {
        self.flush_pending_text();
        if let Some(message) = self.failed_message {
            RunCompletion::Failed {
                message,
                output: self.out,
            }
        } else {
            RunCompletion::Done(self.out)
        }
    }

    fn timeout(mut self) -> RunCompletion {
        self.flush_pending_text();
        RunCompletion::Timeout(self.out)
    }

    fn error(mut self, evt: &serde_json::Value) -> RunCompletion {
        self.flush_pending_text();
        RunCompletion::Failed {
            message: event_message(evt),
            output: self.out,
        }
    }

    fn capture_summary(&mut self, evt: &serde_json::Value) {
        if self.out.completion_summary.is_none() {
            self.out.completion_summary = extract_summary(evt);
        }
    }

    fn capture_git_milestones(&mut self, evt: &serde_json::Value, evt_type: &str) {
        for milestone in extract_git_milestones(evt, evt_type) {
            if !self
                .out
                .git_milestones
                .iter()
                .any(|item| item == &milestone)
            {
                self.out.git_milestones.push(milestone);
            }
        }
    }

    fn capture_text_delta(&mut self, evt: &serde_json::Value) {
        if let Some(text) = first_string(evt, &["text", "delta"]) {
            append_truncated(
                &mut self.out.output_text,
                text,
                MAX_COLLECTED_OUTPUT_TEXT_CHARS,
            );
            append_truncated(&mut self.pending_text, text, MAX_COLLECTED_TEXT_BLOCK_CHARS);
        }
    }

    fn push_tool_start(&mut self, evt: &serde_json::Value) {
        self.flush_pending_text();
        self.out.content_blocks.push(serde_json::json!({
            "type": "tool_use",
            "id": first_string(evt, &["id"]).unwrap_or(""),
            "name": first_string(evt, &["name"]).unwrap_or(""),
            "input": serde_json::Value::Null,
        }));
    }

    fn upsert_tool_call(&mut self, evt: &serde_json::Value) {
        self.flush_pending_text();
        let id = first_string(evt, &["id"]).unwrap_or("");
        let name = first_string(evt, &["name"]).unwrap_or("");
        let input = evt
            .get("input")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        if let Some(block) = self.find_tool_block(id) {
            block["name"] = serde_json::Value::String(name.to_string());
            block["input"] = input;
        } else {
            self.out.content_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            }));
        }
    }

    fn push_tool_result(&mut self, evt: &serde_json::Value) {
        self.out.content_blocks.push(serde_json::json!({
            "type": "tool_result",
            "tool_use_id": first_string(evt, &["tool_use_id", "id"]).unwrap_or(""),
            "name": first_string(evt, &["name"]).unwrap_or(""),
            "result": truncate_with_marker(
                first_string(evt, &["result"]).unwrap_or(""),
                MAX_COLLECTED_TOOL_RESULT_CHARS,
            ),
            "is_error": evt.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false),
        }));
    }

    fn capture_usage(&mut self, evt: &serde_json::Value) {
        let usage = evt.get("usage").unwrap_or(evt);
        update_token_total(
            &mut self.out.input_tokens,
            usage,
            "cumulative_input_tokens",
            "input_tokens",
        );
        update_token_total(
            &mut self.out.output_tokens,
            usage,
            "cumulative_output_tokens",
            "output_tokens",
        );
        if let Some(model) = first_string(usage, &["model"]) {
            self.out.model = Some(model.to_string());
        }
    }

    fn capture_task_failure(&mut self, evt: &serde_json::Value) {
        self.flush_pending_text();
        self.failed_message = Some(event_message(evt));
    }

    fn flush_pending_text(&mut self) {
        if self.pending_text.is_empty() {
            return;
        }
        let text = truncate_with_marker(
            &std::mem::take(&mut self.pending_text),
            MAX_COLLECTED_TEXT_BLOCK_CHARS,
        );
        self.out.content_blocks.push(serde_json::json!({
            "type": "text",
            "text": text,
        }));
    }

    fn find_tool_block(&mut self, id: &str) -> Option<&mut serde_json::Value> {
        self.out.content_blocks.iter_mut().rev().find(|block| {
            block.get("type").and_then(|v| v.as_str()) == Some("tool_use")
                && block.get("id").and_then(|v| v.as_str()) == Some(id)
        })
    }
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
        .filter_map(commit_sha)
        .collect()
}

fn commit_sha(entry: &serde_json::Value) -> Option<String> {
    match entry {
        serde_json::Value::String(sha) => Some(sha.clone()),
        serde_json::Value::Object(map) => map
            .get("sha")
            .or_else(|| map.get("commit_sha"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        _ => None,
    }
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
        if let Some(milestone) = event
            .get(key)
            .and_then(|value| extract_git_milestone_from_value(value, None))
        {
            milestones.push(milestone);
        }
    }
    milestones
}

fn update_token_total(
    target: &mut u64,
    usage: &serde_json::Value,
    cumulative_key: &str,
    delta_key: &str,
) {
    if let Some(cumulative) = usage.get(cumulative_key).and_then(|v| v.as_u64()) {
        *target = cumulative;
    } else if let Some(delta) = usage.get(delta_key).and_then(|v| v.as_u64()) {
        *target += delta;
    }
}

fn event_message(evt: &serde_json::Value) -> String {
    first_string(evt, &["reason", "message", "error"])
        .map(str::to_owned)
        .unwrap_or_else(|| "Automaton execution failed".into())
}
