use super::*;
use aura_os_storage::StorageSessionEvent;

fn session_event(
    event_type: &str,
    task_id: &str,
    content: serde_json::Value,
) -> StorageSessionEvent {
    let mut payload = content.as_object().cloned().unwrap_or_default();
    payload.insert(
        "task_id".into(),
        serde_json::Value::String(task_id.to_string()),
    );
    StorageSessionEvent {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: Some(uuid::Uuid::new_v4().to_string()),
        user_id: None,
        agent_id: None,
        sender: Some("agent".into()),
        project_id: None,
        org_id: None,
        event_type: Some(event_type.into()),
        content: Some(serde_json::Value::Object(payload)),
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}

#[test]
fn task_output_from_events_reads_durable_sync_progress() {
    let task_id = uuid::Uuid::new_v4().to_string();
    let response = task_output_from_events(
        &task_id,
        &[
            session_event(
                "task_output",
                &task_id,
                serde_json::json!({ "text": "done" }),
            ),
            session_event(
                "task_sync_checkpoint",
                &task_id,
                serde_json::json!({
                    "checkpoint": {
                        "kind": "git_committed",
                        "phase": "committed",
                        "commit_sha": "abc123",
                    }
                }),
            ),
            session_event(
                "task_sync_state",
                &task_id,
                serde_json::json!({
                    "sync_state": {
                        "phase": "completed",
                        "status": "pending_push",
                        "last_commit_sha": "abc123",
                        "retry_safe": true,
                        "orphaned_commits": ["abc123"],
                        "needs_reconciliation": true,
                    }
                }),
            ),
        ],
    )
    .expect("response should be hydrated");

    assert_eq!(response.output, "done");
    assert_eq!(response.sync_checkpoints.len(), 1);
    assert_eq!(
        response.recommended_action,
        Some(serde_json::json!({
            "action": "retry_push",
            "commit_sha": "abc123",
            "retry_safe": true,
        })),
    );
}

#[test]
fn task_output_from_events_derives_sync_state_from_legacy_git_steps() {
    let task_id = uuid::Uuid::new_v4().to_string();
    let response = task_output_from_events(
        &task_id,
        &[session_event(
            "task_git_steps",
            &task_id,
            serde_json::json!({
                "git_steps": [
                    { "type": "git_committed", "commit_sha": "abc123" },
                    { "type": "git_push_failed", "reason": "timed out" }
                ]
            }),
        )],
    )
    .expect("response should be hydrated");

    assert_eq!(response.sync_checkpoints.len(), 2);
    assert_eq!(
        response
            .recovery_point
            .as_ref()
            .map(|point| point.commit_sha.as_str()),
        Some("abc123")
    );
    assert_eq!(
        response.recommended_action,
        Some(serde_json::json!({
            "action": "retry_push",
            "commit_sha": "abc123",
            "retry_safe": true,
        })),
    );
}

#[test]
fn task_output_from_events_recommends_decompose_for_truncation_failure() {
    let task_id = uuid::Uuid::new_v4().to_string();
    let response = task_output_from_events(
        &task_id,
        &[
            session_event(
                "task_output",
                &task_id,
                serde_json::json!({ "text": "partial" }),
            ),
            session_event(
                "task_failed",
                &task_id,
                serde_json::json!({
                    "reason": "harness response truncated; needs decomposition",
                }),
            ),
        ],
    )
    .expect("response should be hydrated");

    assert_eq!(
        response.recommended_action,
        Some(serde_json::json!({ "action": "decompose" })),
    );
}

#[test]
fn task_output_from_events_recommends_terminal_for_rate_limited_failure() {
    let task_id = uuid::Uuid::new_v4().to_string();
    let response = task_output_from_events(
        &task_id,
        &[
            session_event(
                "task_output",
                &task_id,
                serde_json::json!({ "text": "retrying" }),
            ),
            session_event(
                "task_failed",
                &task_id,
                serde_json::json!({ "reason": "HTTP 429 too many requests" }),
            ),
        ],
    )
    .expect("response should be hydrated");

    assert_eq!(
        response.recommended_action,
        Some(serde_json::json!({
            "action": "mark_terminal",
            "reason": "rate_limited",
        })),
    );
}

#[test]
fn task_output_from_events_omits_recommendation_when_nothing_actionable() {
    let task_id = uuid::Uuid::new_v4().to_string();
    let response = task_output_from_events(
        &task_id,
        &[session_event(
            "task_output",
            &task_id,
            serde_json::json!({ "text": "hello" }),
        )],
    )
    .expect("response should be hydrated");

    assert!(response.recommended_action.is_none());
}
