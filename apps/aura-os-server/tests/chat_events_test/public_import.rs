use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::{AgentId, OrgId};
use aura_os_projects::CreateProjectInput;
use aura_os_storage::CreateProjectAgentRequest;

use super::common::*;

async fn seed_import_binding() -> (
    axum::Router,
    std::sync::Arc<aura_os_storage::StorageClient>,
    tempfile::TempDir,
    AgentId,
    String,
    String,
) {
    let (app, state, storage, _db, dir) = build_test_app_with_storage_db().await;
    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Imported Public Chat".into(),
            description: "Project for public chat import tests".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

    let agent_id = AgentId::new();
    let project_agent = storage
        .create_project_agent(
            &project.project_id.to_string(),
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "CEO".into(),
                org_id: None,
                role: Some("CEO".into()),
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

    (
        app,
        storage,
        dir,
        agent_id,
        project.project_id.to_string(),
        project_agent.id,
    )
}

fn import_payload(public_session_id: &str) -> serde_json::Value {
    serde_json::json!({
        "publicSessionId": public_session_id,
        "title": "Guest architecture chat",
        "turns": [
            { "role": "user", "content": "Can Aura build this onboarding?" },
            { "role": "assistant", "content": "Yes. Start chat-first, then expose Build with Aura." }
        ]
    })
}

#[tokio::test]
async fn imports_public_chat_into_agent_session_history() {
    let (app, storage, _dir, agent_id, _project_id, _project_agent_id) =
        seed_import_binding().await;

    let resp = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/agents/{agent_id}/public-chat/import"),
            Some(import_payload("public-abc")),
        ))
        .await
        .expect("import request");

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let session_id = body["sessionId"]
        .as_str()
        .expect("sessionId should be returned");
    assert_eq!(body["importedTurnCount"], serde_json::json!(2));
    assert_eq!(body["reusedExisting"], serde_json::json!(false));

    let raw_events = storage
        .list_events(session_id, TEST_JWT, None, None)
        .await
        .expect("list imported events");
    let types: Vec<_> = raw_events
        .iter()
        .filter_map(|event| event.event_type.as_deref())
        .collect();
    assert_eq!(
        types,
        vec![
            "user_message",
            "assistant_message_end",
            "public_chat_import"
        ]
    );

    let history_resp = app
        .oneshot(json_request(
            "GET",
            &format!("/api/agents/{agent_id}/sessions/{session_id}/events"),
            None,
        ))
        .await
        .expect("history request");
    assert_eq!(history_resp.status(), StatusCode::OK);
    let history = response_json(history_resp).await;
    let messages = history.as_array().expect("history array");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[0]["content"], "Can Aura build this onboarding?");
    assert_eq!(messages[1]["role"], "assistant");
    assert_eq!(
        messages[1]["content"],
        "Yes. Start chat-first, then expose Build with Aura."
    );
}

#[tokio::test]
async fn importing_same_public_session_is_idempotent() {
    let (app, storage, _dir, agent_id, _project_id, project_agent_id) = seed_import_binding().await;
    let uri = format!("/api/agents/{agent_id}/public-chat/import");

    let first = app
        .clone()
        .oneshot(json_request(
            "POST",
            &uri,
            Some(import_payload("public-once")),
        ))
        .await
        .expect("first import");
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = response_json(first).await;
    let first_session_id = first_body["sessionId"].as_str().unwrap().to_string();

    let second = app
        .oneshot(json_request(
            "POST",
            &uri,
            Some(import_payload("public-once")),
        ))
        .await
        .expect("second import");
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = response_json(second).await;
    assert_eq!(
        second_body["sessionId"].as_str(),
        Some(first_session_id.as_str())
    );
    assert_eq!(second_body["reusedExisting"], serde_json::json!(true));

    let sessions = storage
        .list_sessions(&project_agent_id, TEST_JWT)
        .await
        .expect("list sessions");
    assert_eq!(
        sessions.len(),
        1,
        "retry must not create a duplicate session"
    );
}

#[tokio::test]
async fn concurrent_import_of_same_public_session_creates_one_session() {
    let (app, storage, _dir, agent_id, _project_id, project_agent_id) = seed_import_binding().await;
    let uri = format!("/api/agents/{agent_id}/public-chat/import");

    let first_app = app.clone();
    let first_uri = uri.clone();
    let second_app = app.clone();
    let second_uri = uri.clone();
    let (first, second) = tokio::join!(
        async move {
            first_app
                .oneshot(json_request(
                    "POST",
                    &first_uri,
                    Some(import_payload("public-concurrent")),
                ))
                .await
                .expect("first import")
        },
        async move {
            second_app
                .oneshot(json_request(
                    "POST",
                    &second_uri,
                    Some(import_payload("public-concurrent")),
                ))
                .await
                .expect("second import")
        }
    );

    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(second.status(), StatusCode::OK);
    let first_body = response_json(first).await;
    let second_body = response_json(second).await;
    assert_eq!(first_body["sessionId"], second_body["sessionId"]);
    assert_ne!(first_body["reusedExisting"], second_body["reusedExisting"]);

    let sessions = storage
        .list_sessions(&project_agent_id, TEST_JWT)
        .await
        .expect("list sessions");
    assert_eq!(
        sessions.len(),
        1,
        "concurrent import must not create duplicate sessions"
    );
}
