//! Read-only status checks must use the saved command in the exact session,
//! never open a harness turn or expose a different project/agent lane.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{CreateSessionEventRequest, CreateSessionRequest};

use common::*;

fn owned_agent() -> Agent {
    let now = chrono::Utc::now();
    let agent_id = AgentId::new();
    Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Status Agent".into(),
        role: "Assistant".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        auth_source: "aura_managed".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        wallet_address: None,
        network_agent_id: Some(agent_id),
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::full_access(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

#[tokio::test]
async fn status_route_reads_exact_saved_command_and_rejects_wrong_project() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;
    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Command Status".into(),
            description: String::new(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("project");
    let agent = owned_agent();
    state
        .agent_service
        .save_agent_shadow(&agent)
        .expect("agent shadow");
    let instance = state
        .agent_instance_service
        .create_instance_from_agent(&project.project_id, &agent)
        .await
        .expect("agent instance");
    let session = storage
        .create_session(
            &instance.agent_instance_id.to_string(),
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project.project_id.to_string(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("session");
    let write = |event_type: &str, content: serde_json::Value| CreateSessionEventRequest {
        session_id: Some(session.id.clone()),
        user_id: None,
        agent_id: Some(instance.agent_instance_id.to_string()),
        sender: Some(
            if event_type == "user_message" {
                "user"
            } else {
                "agent"
            }
            .into(),
        ),
        project_id: Some(project.project_id.to_string()),
        org_id: None,
        event_type: event_type.into(),
        content: Some(content),
    };
    storage
        .create_event(
            &session.id,
            TEST_JWT,
            &write(
                "user_message",
                serde_json::json!({"text":"hello", "client_command_id":"cmd-1"}),
            ),
        )
        .await
        .expect("saved command");

    let project_uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/commands/cmd-1/status",
        project.project_id, instance.agent_instance_id, session.id,
    );
    let response = app
        .clone()
        .oneshot(json_request("GET", &project_uri, None))
        .await
        .expect("status response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await["executionStatus"],
        "unconfirmed"
    );

    storage
        .create_event(
            &session.id,
            TEST_JWT,
            &write(
                "chat_command_terminal",
                serde_json::json!({"client_command_id":"cmd-1", "status":"completed"}),
            ),
        )
        .await
        .expect("terminal marker");
    let response = app
        .clone()
        .oneshot(json_request("GET", &project_uri, None))
        .await
        .expect("completed status");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await["executionStatus"],
        "completed"
    );

    let missing_command_uri = project_uri.replace("cmd-1", "other-command");
    let response = app
        .clone()
        .oneshot(json_request("GET", &missing_command_uri, None))
        .await
        .expect("missing command");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let wrong_project_uri = project_uri.replace(
        &project.project_id.to_string(),
        &ProjectId::new().to_string(),
    );
    let response = app
        .clone()
        .oneshot(json_request("GET", &wrong_project_uri, None))
        .await
        .expect("wrong project");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let wrong_project_chat_uri = format!(
        "/api/projects/{}/agents/{}/events/stream",
        ProjectId::new(),
        instance.agent_instance_id,
    );
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &wrong_project_chat_uri,
            Some(serde_json::json!({"content":"must not execute"})),
        ))
        .await
        .expect("wrong-project chat");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let standalone_uri = format!(
        "/api/agents/{}/sessions/{}/commands/cmd-1/status",
        agent.agent_id, session.id,
    );
    let response = app
        .oneshot(json_request("GET", &standalone_uri, None))
        .await
        .expect("standalone status");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await["executionStatus"],
        "completed"
    );
}
