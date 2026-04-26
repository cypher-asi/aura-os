//! Recent-window aggregation and current-session-only LLM context loaders.
//!
//! Regression: before the fix, "Clear session" only rotated the storage write
//! target and cleared in-memory caches. The LLM-context loaders aggregated
//! every past storage session, so a corrupted `tool_use` block left behind by
//! a crashed harness kept getting re-injected on cold starts / cache misses.
//!
//! The fix scopes LLM-context loads to the *current* storage session only
//! (the one `resolve_chat_session(force_new=false)` picks). UI history
//! endpoints still aggregate across sessions — those tests live in
//! `history.rs` and remain unchanged.

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, StorageClient,
};

use super::common::*;

#[tokio::test]
async fn standalone_agent_events_support_recent_window() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Agent History".into(),
            description: "Project for agent history tests".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create local project");

    let agent_id = AgentId::new();
    let project_agent = storage
        .create_project_agent(
            &project.project_id.to_string(),
            jwt,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Logos".into(),
                org_id: None,
                role: Some("Researcher".into()),
                instance_role: None,
                personality: Some("Detailed".into()),
                system_prompt: Some("Investigate everything".into()),
                skills: Some(vec![]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    let session = storage
        .create_session(
            &project_agent.id,
            jwt,
            &CreateSessionRequest {
                project_id: project.project_id.to_string(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    for idx in 0..5 {
        storage
            .create_event(
                &session.id,
                jwt,
                &CreateSessionEventRequest {
                    event_type: "assistant_message_end".into(),
                    sender: Some("agent".into()),
                    project_id: Some(project.project_id.to_string()),
                    agent_id: Some(project_agent.id.clone()),
                    org_id: None,
                    user_id: None,
                    content: Some(serde_json::json!({
                        "text": format!("Event {idx}"),
                    })),
                    session_id: Some(session.id.clone()),
                },
            )
            .await
            .expect("create history event");
    }

    let req = json_request(
        "GET",
        &format!("/api/agents/{agent_id}/events?limit=2&offset=1"),
        None,
    );
    let resp = app
        .clone()
        .oneshot(req)
        .await
        .expect("request should succeed");

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let arr = body.as_array().expect("response should be an array");
    assert_eq!(arr.len(), 2, "recent window should contain 2 events");
    assert_eq!(arr[0]["content"], "Event 2");
    assert_eq!(arr[1]["content"], "Event 3");
}

async fn create_session_with_user_event(
    storage: &StorageClient,
    project_agent_id: &str,
    project_id: &str,
    jwt: &str,
    text: &str,
) -> String {
    let session = storage
        .create_session(
            project_agent_id,
            jwt,
            &CreateSessionRequest {
                project_id: project_id.to_string(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");
    storage
        .create_event(
            &session.id,
            jwt,
            &CreateSessionEventRequest {
                event_type: "user_message".into(),
                sender: Some("user".into()),
                project_id: Some(project_id.to_string()),
                agent_id: Some(project_agent_id.to_string()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({ "text": text })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("create user event");
    session.id
}

#[tokio::test]
async fn current_session_loader_excludes_prior_sessions_for_agent() {
    let (_app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Reset Scope Test".into(),
            description: "Regression for LLM context re-injection".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let project_agent = storage
        .create_project_agent(
            &project.project_id.to_string(),
            jwt,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Logos".into(),
                org_id: None,
                role: Some("Researcher".into()),
                instance_role: None,
                personality: None,
                system_prompt: None,
                skills: Some(vec![]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    // S_old: simulates a "corrupted" prior session the user has reset away from.
    let _s_old = create_session_with_user_event(
        &storage,
        &project_agent.id,
        &project.project_id.to_string(),
        jwt,
        "old session message (should NOT appear in LLM context)",
    )
    .await;

    // Ensure S_new gets a strictly-later started_at timestamp.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // S_new: the fresh session created by reset.
    let _s_new = create_session_with_user_event(
        &storage,
        &project_agent.id,
        &project.project_id.to_string(),
        jwt,
        "new session message (should appear in LLM context)",
    )
    .await;

    let history = aura_os_server::handlers_test_support::load_current_session_events_for_agent_pub(
        &state, &agent_id, jwt,
    )
    .await;

    assert_eq!(
        history.len(),
        1,
        "LLM context must contain exactly the current session's events, not aggregated history"
    );
    assert_eq!(history[0].role, ChatRole::User);
    assert_eq!(
        history[0].content, "new session message (should appear in LLM context)",
        "current-session loader returned events from a prior session"
    );
}

#[tokio::test]
async fn current_session_loader_excludes_prior_sessions_for_instance() {
    let (_app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let project_id = ProjectId::new();
    let agent_instance_id = AgentInstanceId::new();

    let _s_old = create_session_with_user_event(
        &storage,
        &agent_instance_id.to_string(),
        &project_id.to_string(),
        jwt,
        "old instance session (should NOT appear)",
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let _s_new = create_session_with_user_event(
        &storage,
        &agent_instance_id.to_string(),
        &project_id.to_string(),
        jwt,
        "new instance session (should appear)",
    )
    .await;

    let history =
        aura_os_server::handlers_test_support::load_current_session_events_for_instance_pub(
            &state,
            &agent_instance_id,
            jwt,
        )
        .await
        .expect("loader succeeds");

    assert_eq!(
        history.len(),
        1,
        "LLM context for instance must contain only the current session's events"
    );
    assert_eq!(history[0].role, ChatRole::User);
    assert_eq!(
        history[0].content, "new instance session (should appear)",
        "current-session instance loader returned events from a prior session"
    );
}
