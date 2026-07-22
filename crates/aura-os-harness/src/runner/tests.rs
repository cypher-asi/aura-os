use super::{collect_automaton_events, connect_with_retries, RunCompletion};
use async_trait::async_trait;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

use crate::{HarnessLink, HarnessSession, SessionConfig};

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

#[tokio::test]
async fn collect_automaton_events_exposes_task_failed_message() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(serde_json::json!({
        "type": "task_failed",
        "reason": "Insufficient credits: Anthropic API error: 402 Payment Required",
    }))
    .unwrap();
    tx.send(serde_json::json!({ "type": "done" })).unwrap();

    let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;

    assert_eq!(
        completion.failure_message(),
        Some("Insufficient credits: Anthropic API error: 402 Payment Required")
    );
}

#[tokio::test]
async fn collect_automaton_events_exposes_error_message() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(serde_json::json!({
        "type": "error",
        "message": "INSUFFICIENT_CREDITS",
    }))
    .unwrap();

    let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;

    assert_eq!(completion.failure_message(), Some("INSUFFICIENT_CREDITS"));
}

#[tokio::test]
async fn collect_automaton_events_done_has_no_failure_message() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(serde_json::json!({
        "type": "text_delta",
        "text": "all good",
    }))
    .unwrap();
    tx.send(serde_json::json!({ "type": "done" })).unwrap();

    let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;

    assert!(completion.is_success(), "done run must report success");
    assert_eq!(
        completion.failure_message(),
        None,
        "clean done must not synthesize a failure reason"
    );
    assert!(matches!(completion, RunCompletion::Done(_)));
}

#[tokio::test]
async fn collect_automaton_events_timeout_synthesizes_failure_message() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(serde_json::json!({
        "type": "text_delta",
        "text": "partial output",
    }))
    .unwrap();

    let completion = collect_automaton_events(rx, Duration::from_millis(50), |_evt, _ty| {}).await;
    drop(tx);

    assert!(
        !completion.is_success(),
        "timeout must not be reported as success"
    );
    let message = completion
        .failure_message()
        .expect("Timeout must carry a synthetic failure message");
    assert!(
        !message.is_empty(),
        "Timeout failure message must be non-empty"
    );
    assert!(matches!(completion, RunCompletion::Timeout(_)));
}

#[tokio::test]
async fn collect_automaton_events_stream_close_without_failure_is_not_done() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(serde_json::json!({
        "type": "text_delta",
        "text": "started but never finished",
    }))
    .unwrap();
    drop(tx);

    let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;

    assert!(
        !completion.is_success(),
        "stream close without `done` must not be classified as success"
    );
    let message = completion
        .failure_message()
        .expect("StreamClosed must carry a synthetic failure message");
    assert!(
        !message.is_empty(),
        "StreamClosed failure message must be non-empty"
    );
    assert!(
        matches!(completion, RunCompletion::StreamClosed(_)),
        "stream close without prior task_failed must surface as StreamClosed, not Done/Failed"
    );
}

#[tokio::test]
async fn collect_automaton_events_stream_close_after_task_failed_keeps_reason() {
    let (tx, rx) = broadcast::channel(16);
    tx.send(serde_json::json!({
        "type": "task_failed",
        "reason": "explicit harness failure reason",
    }))
    .unwrap();
    drop(tx);

    let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;

    assert_eq!(
        completion.failure_message(),
        Some("explicit harness failure reason"),
        "explicit task_failed reason must win over any synthetic StreamClosed text"
    );
    assert!(matches!(&completion, RunCompletion::Failed { .. }));
}

#[tokio::test]
async fn collect_automaton_events_fails_instead_of_silently_skipping_lagged_events() {
    let (tx, rx) = broadcast::channel(1);
    tx.send(serde_json::json!({
        "type": "text_delta",
        "text": "first event that will be overwritten",
    }))
    .unwrap();
    tx.send(serde_json::json!({ "type": "done" })).unwrap();

    let completion = collect_automaton_events(rx, Duration::from_secs(1), |_evt, _ty| {}).await;

    assert!(matches!(&completion, RunCompletion::Failed { .. }));
    assert!(
        completion
            .failure_message()
            .is_some_and(|message| message.contains("1 event(s) skipped")),
        "lagged streams must surface an explicit integrity failure"
    );
}

struct PrimedAttachHarness;

#[async_trait]
impl HarnessLink for PrimedAttachHarness {
    async fn open_session(&self, _config: SessionConfig) -> anyhow::Result<HarnessSession> {
        anyhow::bail!("not used")
    }

    async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn attach_run_at_url(
        &self,
        run_id: &str,
        _event_stream_url: Option<&str>,
        _auth_token: Option<&str>,
        _wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        let (events_tx, _) = broadcast::channel(8);
        let (raw_events_tx, _) = broadcast::channel(8);
        let raw_events_rx = vec![raw_events_tx.subscribe(), raw_events_tx.subscribe()];
        let (commands_tx, _commands_rx) = mpsc::channel(8);
        raw_events_tx
            .send(serde_json::json!({
                "type": "progress",
                "stage": "replayed-before-return",
            }))
            .expect("primed receivers keep the early event alive");
        Ok(HarnessSession {
            session_id: run_id.to_string(),
            run_id: run_id.to_string(),
            events_tx,
            raw_events_tx,
            commands_tx,
            pending_events: Vec::new(),
            events_rx: None,
            raw_events_rx,
        })
    }
}

#[tokio::test]
async fn connect_with_retries_preserves_attach_time_raw_events_for_both_consumers() {
    let (mut stream, _handle) = connect_with_retries(
        &PrimedAttachHarness,
        "run-1",
        Some("/stream/run-1"),
        None,
        0,
    )
    .await
    .expect("attach succeeds");

    let live = stream.events_rx.recv().await.expect("live receiver event");
    let persisted = stream
        .persist_events_rx
        .recv()
        .await
        .expect("persist receiver event");
    assert_eq!(live["stage"], "replayed-before-return");
    assert_eq!(persisted, live);
}
