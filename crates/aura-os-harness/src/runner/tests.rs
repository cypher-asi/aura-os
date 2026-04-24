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
