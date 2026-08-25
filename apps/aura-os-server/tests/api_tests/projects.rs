use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest};

use crate::common::*;

#[tokio::test]
async fn project_crud() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "Test Project",
            "description": "A test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let project_id = body["project_id"].as_str().unwrap().to_string();
    assert_eq!(body["name"], "Test Project");

    let req = json_request("GET", &format!("/api/projects?org_id={}", org_id), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 1);

    let req = json_request("GET", &format!("/api/projects/{project_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Test Project");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}"),
        Some(serde_json::json!({"name": "Updated Name"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Updated Name");

    // Archive (returns project from network; archive status not yet supported on network)
    let req = json_request("POST", &format!("/api/projects/{project_id}/archive"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body.get("project_id").is_some() || body.get("name").is_some());
}

#[tokio::test]
async fn project_update_preserves_local_build_and_test_commands() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "Tooling Project",
            "description": "A project with local commands"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let project_id = body["project_id"].as_str().unwrap().to_string();

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}"),
        Some(serde_json::json!({
            "build_command": "npm run build",
            "test_command": "npm test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["build_command"], "npm run build");
    assert_eq!(body["test_command"], "npm test");

    let req = json_request("GET", &format!("/api/projects/{project_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["build_command"], "npm run build");
    assert_eq!(body["test_command"], "npm test");
}

#[tokio::test]
async fn project_workspace_tool_endpoint_sets_and_clears_local_path() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": OrgId::new(),
            "name": "Local Workspace Project",
            "description": ""
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let project_id = body["project_id"].as_str().unwrap();
    let workspace_endpoint = format!("/api/projects/{project_id}/workspace");

    let req = json_request(
        "POST",
        &workspace_endpoint,
        Some(serde_json::json!({
            "local_workspace_path": "  C:\\code\\attached-project  "
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["local_workspace_path"], "C:\\code\\attached-project");

    let req = json_request(
        "POST",
        &workspace_endpoint,
        Some(serde_json::json!({ "local_workspace_path": null })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body["local_workspace_path"].is_null());

    let req = json_request("POST", &workspace_endpoint, Some(serde_json::json!({})));
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn project_list_excludes_stale_local_shadows_when_network_is_available() {
    let (app, state, _db) = build_test_app_with_mocks().await;

    let stale = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Stale Local Project".to_string(),
            description: "belongs to an org outside current membership".to_string(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("seed stale local project shadow");
    let stale_project_id = stale.project_id.to_string();

    let req = json_request("GET", "/api/projects", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let projects = body.as_array().expect("projects array");

    assert!(
        projects.iter().all(|project| {
            project.get("project_id").and_then(|id| id.as_str()) != Some(stale_project_id.as_str())
        }),
        "unscoped project list must not expose stale local shadows"
    );
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["name"], "Test Project");
}

#[tokio::test]
async fn project_not_found() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "network_error");
}

#[tokio::test]
async fn project_create_invalid_name() {
    let (app, _, _db) = build_test_app();

    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "",
            "description": "desc"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

fn project_manager_agent(org_id: OrgId, permissions: AgentPermissions) -> Agent {
    let now = chrono::Utc::now();
    Agent {
        agent_id: AgentId::new(),
        user_id: "u1".into(),
        org_id: Some(org_id),
        name: "CEO".into(),
        role: "CEO".into(),
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
        network_agent_id: None,
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions,
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

#[tokio::test]
async fn agent_can_create_bind_and_move_chat_into_a_project() {
    let (app, state, storage, _db, _dir) = build_test_app_with_storage_db().await;
    let org_id = OrgId::new();
    let agent = project_manager_agent(org_id, AgentPermissions::full_access());
    state.agent_service.save_agent_shadow(&agent).unwrap();

    let source_project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id,
            name: "CEO Home".into(),
            description: String::new(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .unwrap();
    let source_binding = storage
        .create_project_agent(
            &source_project.project_id.to_string(),
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent.agent_id.to_string(),
                name: agent.name.clone(),
                org_id: Some(org_id.to_string()),
                role: Some(agent.role.clone()),
                personality: None,
                system_prompt: None,
                skills: Some(vec![]),
                icon: None,
                harness: None,
                instance_role: Some("chat".into()),
                source: Some("auto_home".into()),
                permissions: Some(agent.permissions.clone()),
                intent_classifier: None,
            },
        )
        .await
        .unwrap();
    let source_session = storage
        .create_session(
            &source_binding.id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: source_project.project_id.to_string(),
                org_id: Some(org_id.to_string()),
                model: Some("openai/gpt-5.4".into()),
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: Some("Social Ninja plan".into()),
            },
        )
        .await
        .unwrap();
    storage
        .create_event(
            &source_session.id,
            TEST_JWT,
            &CreateSessionEventRequest {
                session_id: Some(source_session.id.clone()),
                user_id: Some("u1".into()),
                agent_id: Some(agent.agent_id.to_string()),
                sender: Some("user".into()),
                project_id: Some(source_project.project_id.to_string()),
                org_id: Some(org_id.to_string()),
                event_type: "user_message".into(),
                content: Some(serde_json::json!({ "content": "Build Social Ninja" })),
            },
        )
        .await
        .unwrap();

    let endpoint = format!(
        "/api/agents/{}/projects?org_id={org_id}&source_session_id={}",
        agent.agent_id, source_session.id
    );
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &endpoint,
            Some(serde_json::json!({
                "name": "Social Ninja",
                "description": "Specs agreed with the CEO"
            })),
        ))
        .await
        .unwrap();
    let status = response.status();
    let body = response_json(response).await;
    assert_eq!(status, StatusCode::CREATED, "response body: {body}");
    let project_id = body["project"]["project_id"].as_str().unwrap();
    let project_agent_id = body["agent_instance"]["agent_instance_id"]
        .as_str()
        .unwrap();
    let moved_session_id = body["session_id"].as_str().unwrap();
    assert_eq!(body["project_id"], project_id);
    assert_eq!(body["agent_instance_id"], project_agent_id);
    assert_eq!(body["conversation_moved"], true);
    assert_eq!(body["copied_event_count"], 1);
    assert!(body["chat_route"]
        .as_str()
        .unwrap()
        .contains(&format!("session={moved_session_id}")));

    let moved_events = storage
        .list_events(moved_session_id, TEST_JWT, None, None)
        .await
        .unwrap();
    assert_eq!(moved_events.len(), 1);
    assert_eq!(moved_events[0].project_id.as_deref(), Some(project_id));

    let response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/agents/{}/projects/access", agent.agent_id),
            Some(serde_json::json!({
                "project_id": project_id,
                "move_current_conversation": false
            })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(
        body["agent_instance"]["agent_instance_id"],
        project_agent_id
    );
    assert!(body["session_id"].is_null());
}

#[tokio::test]
async fn agent_project_api_requires_write_all_projects() {
    let (app, state, _storage, _db, _dir) = build_test_app_with_storage_db().await;
    let org_id = OrgId::new();
    let mut agent = project_manager_agent(org_id, AgentPermissions::empty());
    agent.name = "Restricted".into();
    agent.role = "developer".into();
    state.agent_service.save_agent_shadow(&agent).unwrap();

    let response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/agents/{}/projects?org_id={org_id}", agent.agent_id),
            Some(serde_json::json!({ "name": "Denied" })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
