use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::{AgentId, OrgId};
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest};

use super::common::*;

#[tokio::test]
async fn branch_session_copies_only_through_selected_assistant_reply() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";
    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Branching".into(),
            description: "Conversation branch integration test".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create local project");
    let project_agent = storage
        .create_project_agent(
            &project.project_id.to_string(),
            jwt,
            &CreateProjectAgentRequest {
                agent_id: AgentId::new().to_string(),
                name: "Hermes".into(),
                org_id: None,
                role: Some("Assistant".into()),
                instance_role: None,
                source: None,
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
    let source = storage
        .create_session(
            &project_agent.id,
            jwt,
            &CreateSessionRequest {
                project_id: project.project_id.to_string(),
                org_id: None,
                model: Some("test-model".into()),
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: Some("Original path".into()),
            },
        )
        .await
        .expect("create source session");

    let mut created = Vec::new();
    for (event_type, text, sender) in [
        ("user_message", "First question", "user"),
        ("assistant_message_end", "First answer", "agent"),
        ("user_message", "Later question", "user"),
        ("assistant_message_end", "Later answer", "agent"),
    ] {
        created.push(
            storage
                .create_event(
                    &source.id,
                    jwt,
                    &CreateSessionEventRequest {
                        session_id: Some(source.id.clone()),
                        user_id: None,
                        agent_id: Some(project_agent.id.clone()),
                        sender: Some(sender.into()),
                        project_id: Some(project.project_id.to_string()),
                        org_id: None,
                        event_type: event_type.into(),
                        content: Some(serde_json::json!({ "text": text })),
                    },
                )
                .await
                .expect("create event"),
        );
    }

    let response = app
        .oneshot(json_request(
            "POST",
            &format!(
                "/api/projects/{}/agents/{}/sessions/{}/branch",
                project.project_id, project_agent.id, source.id
            ),
            Some(serde_json::json!({ "throughEventId": created[1].id })),
        ))
        .await
        .expect("branch request succeeds");
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["copiedEvents"], 2);
    let branch_id = body["sessionId"].as_str().expect("new session id");

    let branch_events = storage
        .list_events(branch_id, jwt, None, None)
        .await
        .expect("list branch events");
    assert_eq!(branch_events.len(), 2);
    assert_eq!(
        branch_events[0].content.as_ref().unwrap()["text"],
        "First question"
    );
    assert_eq!(
        branch_events[1].content.as_ref().unwrap()["text"],
        "First answer"
    );

    let source_events = storage
        .list_events(&source.id, jwt, None, None)
        .await
        .expect("list original events");
    assert_eq!(source_events.len(), 4, "source session remains unchanged");
}

#[tokio::test]
async fn branch_session_rejects_non_assistant_branch_points() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";
    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Branch validation".into(),
            description: String::new(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create local project");
    let project_agent = storage
        .create_project_agent(
            &project.project_id.to_string(),
            jwt,
            &CreateProjectAgentRequest {
                agent_id: AgentId::new().to_string(),
                name: "Hermes".into(),
                org_id: None,
                role: None,
                instance_role: None,
                source: None,
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
    let source = storage
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
        .expect("create source session");
    let user_event = storage
        .create_event(
            &source.id,
            jwt,
            &CreateSessionEventRequest {
                session_id: Some(source.id.clone()),
                user_id: None,
                agent_id: Some(project_agent.id.clone()),
                sender: Some("user".into()),
                project_id: Some(project.project_id.to_string()),
                org_id: None,
                event_type: "user_message".into(),
                content: Some(serde_json::json!({ "text": "Not a valid branch point" })),
            },
        )
        .await
        .expect("create user event");

    let response = app
        .oneshot(json_request(
            "POST",
            &format!(
                "/api/projects/{}/agents/{}/sessions/{}/branch",
                project.project_id, project_agent.id, source.id
            ),
            Some(serde_json::json!({ "throughEventId": user_event.id })),
        ))
        .await
        .expect("validation response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
