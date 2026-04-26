//! Storage-session ordering tests for the agent-discovery layer.

use aura_os_storage::StorageSession;

use super::super::discovery::latest_storage_session;

fn storage_session(id: &str, started_at: Option<&str>, created_at: Option<&str>) -> StorageSession {
    StorageSession {
        id: id.to_string(),
        project_agent_id: None,
        project_id: None,
        org_id: None,
        model: None,
        status: None,
        context_usage_estimate: None,
        total_input_tokens: None,
        total_output_tokens: None,
        summary_of_previous_context: None,
        tasks_worked_count: None,
        ended_at: None,
        started_at: started_at.map(str::to_string),
        created_at: created_at.map(str::to_string),
        updated_at: None,
    }
}

#[test]
fn latest_storage_session_prefers_newest_started_at() {
    let older = storage_session("older", Some("2026-04-14T10:00:00Z"), None);
    let newer = storage_session("newer", Some("2026-04-15T10:00:00Z"), None);

    let selected = latest_storage_session(&[older, newer]).map(|session| session.id.clone());

    assert_eq!(selected.as_deref(), Some("newer"));
}

#[test]
fn latest_storage_session_falls_back_to_created_at() {
    let older = storage_session("older", None, Some("2026-04-14T10:00:00Z"));
    let newer = storage_session("newer", None, Some("2026-04-15T10:00:00Z"));

    let selected = latest_storage_session(&[older, newer]).map(|session| session.id.clone());

    assert_eq!(selected.as_deref(), Some("newer"));
}

#[test]
fn latest_storage_session_handles_mixed_timestamp_formats() {
    // Regression: `started_at` written by different storage backends or
    // client versions can come back with and without explicit offsets or
    // fractional seconds. A raw string compare would sort
    // "2026-04-15T10:00:00Z" *before*
    // "2026-04-15T10:00:00.123+00:00" even though the latter is later
    // in wall-clock time, so the reader could pick a stale session and
    // the UI would only show part of the conversation.
    let earlier = storage_session("earlier", Some("2026-04-15T10:00:00Z"), None);
    let later = storage_session("later", Some("2026-04-15T10:00:00.123+00:00"), None);

    let selected = latest_storage_session(&[earlier, later]).map(|session| session.id.clone());

    assert_eq!(selected.as_deref(), Some("later"));
}

#[test]
fn latest_storage_session_prefers_parseable_timestamp_over_missing() {
    // A session without any recency signal must never beat a session
    // with a valid `started_at`, even if they happen to be in an order
    // where a string compare of "" vs "2026-..." would make the empty
    // value larger (it doesn't, but defense-in-depth against future
    // field additions).
    let missing = storage_session("missing", None, None);
    let dated = storage_session("dated", Some("2024-01-01T00:00:00Z"), None);

    let selected = latest_storage_session(&[missing, dated]).map(|session| session.id.clone());

    assert_eq!(selected.as_deref(), Some("dated"));
}
