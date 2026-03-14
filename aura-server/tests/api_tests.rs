use std::collections::HashMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, Mutex};
use tower::ServiceExt;

use aura_core::*;
use aura_engine::EngineEvent;
use aura_server::state::{AppState, TaskOutputBuffers};
use aura_services::*;
use aura_settings::SettingsService;
use aura_store::RocksStore;

fn build_test_app() -> (Router, AppState, tempfile::TempDir, tempfile::TempDir) {
    let db_dir = tempfile::tempdir().unwrap();
    let data_dir = tempfile::tempdir().unwrap();

    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    let settings_service = Arc::new(SettingsService::new(store.clone(), data_dir.path()).unwrap());
    let claude_client = Arc::new(ClaudeClient::new());
    let org_service = Arc::new(OrgService::new(store.clone()));
    let github_service = Arc::new(GitHubService::new(store.clone(), org_service.clone()));
    let auth_service = Arc::new(AuthService::new(store.clone()));
    let project_service = Arc::new(ProjectService::new(store.clone()));
    let spec_gen_service = Arc::new(SpecGenerationService::new(
        store.clone(),
        settings_service.clone(),
        claude_client.clone(),
    ));
    let task_extraction_service = Arc::new(TaskExtractionService::new(
        store.clone(),
        settings_service.clone(),
        claude_client.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone()));
    let session_service = Arc::new(SessionService::new(store.clone()));
    let chat_service = Arc::new(ChatService::new(
        store.clone(),
        settings_service.clone(),
        claude_client.clone(),
        spec_gen_service.clone(),
    ));

    let (event_tx, _event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(256);
    let task_output_buffers: TaskOutputBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let state = AppState {
        store,
        org_service,
        github_service,
        auth_service,
        settings_service,
        project_service,
        spec_gen_service,
        task_extraction_service,
        task_service,
        agent_service,
        session_service,
        chat_service,
        claude_client,
        event_tx,
        event_broadcast,
        loop_handle: Arc::new(Mutex::new(None)),
        loop_project_id: Arc::new(Mutex::new(None)),
        task_output_buffers,
    };

    let app = aura_server::create_router(state.clone());
    (app, state, db_dir, data_dir)
}

fn json_request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");

    match body {
        Some(b) => builder
            .body(Body::from(serde_json::to_vec(&b).unwrap()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn response_json(response: axum::http::Response<Body>) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

// ---------------------------------------------------------------------------
// Settings Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn settings_api_key_lifecycle() {
    let (app, _, _db, _data) = build_test_app();

    // GET before set -> not_set
    let req = json_request("GET", "/api/settings/api-key", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["status"], "not_set");

    // POST set key
    let req = json_request(
        "POST",
        "/api/settings/api-key",
        Some(serde_json::json!({"api_key": "sk-ant-test123456789"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["status"], "validation_pending");
    assert!(body["masked_key"].as_str().unwrap().contains("..."));

    // GET after set -> has masked key
    let req = json_request("GET", "/api/settings/api-key", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body["masked_key"].is_string());

    // DELETE
    let req = json_request("DELETE", "/api/settings/api-key", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // GET after delete -> not_set
    let req = json_request("GET", "/api/settings/api-key", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    let body = response_json(resp).await;
    assert_eq!(body["status"], "not_set");
}

#[tokio::test]
async fn settings_plain_setting() {
    let (app, _, _db, _data) = build_test_app();

    // PUT a setting
    let req = json_request(
        "PUT",
        "/api/settings/theme",
        Some(serde_json::json!({"value": "dark"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // GET the setting
    let req = json_request("GET", "/api/settings/theme", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["key"], "theme");
    assert_eq!(body["value"], "dark");
}

// ---------------------------------------------------------------------------
// Project Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_crud() {
    let (app, _, _db, _data) = build_test_app();

    // Create a temp dir for the project linked folder
    let project_dir = tempfile::tempdir().unwrap();

    // Create
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "name": "Test Project",
            "description": "A test",
            "linked_folder_path": project_dir.path().to_string_lossy()
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let project_id = body["project_id"].as_str().unwrap().to_string();
    assert_eq!(body["name"], "Test Project");

    // List
    let req = json_request("GET", "/api/projects", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 1);

    // Get
    let req = json_request("GET", &format!("/api/projects/{project_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Test Project");

    // Update
    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}"),
        Some(serde_json::json!({"name": "Updated Name"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Updated Name");

    // Archive
    let req = json_request("POST", &format!("/api/projects/{project_id}/archive"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["current_status"], "archived");
}

#[tokio::test]
async fn project_not_found() {
    let (app, _, _db, _data) = build_test_app();

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "not_found");
}

#[tokio::test]
async fn project_create_invalid_name() {
    let (app, _, _db, _data) = build_test_app();

    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "name": "",
            "description": "desc",
            "linked_folder_path": "."
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

// ---------------------------------------------------------------------------
// Task/Progress Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn task_list_and_progress() {
    let (app, state, _db, _data) = build_test_app();

    let project_dir = tempfile::tempdir().unwrap();

    let now = chrono::Utc::now();
    let pid = ProjectId::new();
    let project = Project {
        project_id: pid,
        name: "Test".into(),
        description: "d".into(),
        linked_folder_path: project_dir.path().to_string_lossy().to_string(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        created_at: now,
        updated_at: now,
    };
    state.store.put_project(&project).unwrap();

    let sid = SpecId::new();
    let spec = Spec {
        spec_id: sid,
        project_id: pid,
        title: "Spec 1".into(),
        order_index: 0,
        markdown_contents: "content".into(),
        sprint_id: None,
        created_at: now,
        updated_at: now,
    };
    state.store.put_spec(&spec).unwrap();

    let task = Task {
        task_id: TaskId::new(),
        project_id: pid,
        spec_id: sid,
        title: "Task 1".into(),
        description: "Do stuff".into(),
        status: TaskStatus::Ready,
        order_index: 0,
        dependency_ids: vec![],
        assigned_agent_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: vec![],
        live_output: String::new(),
        created_at: now,
        updated_at: now,
    };
    state.store.put_task(&task).unwrap();

    // List tasks
    let req = json_request("GET", &format!("/api/projects/{pid}/tasks"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 1);

    // Progress
    let req = json_request("GET", &format!("/api/projects/{pid}/progress"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["total_tasks"], 1);
    assert_eq!(body["ready_tasks"], 1);
    assert_eq!(body["completion_percentage"], 0.0);
}

// ---------------------------------------------------------------------------
// Agent Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_list_empty() {
    let (app, state, _db, _data) = build_test_app();

    let pid = ProjectId::new();
    let now = chrono::Utc::now();
    let project = Project {
        project_id: pid,
        name: "Test".into(),
        description: "d".into(),
        linked_folder_path: ".".into(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        created_at: now,
        updated_at: now,
    };
    state.store.put_project(&project).unwrap();

    let req = json_request("GET", &format!("/api/projects/{pid}/agents"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn agent_not_found() {
    let (app, _, _db, _data) = build_test_app();

    let pid = ProjectId::new();
    let aid = AgentId::new();
    let req = json_request("GET", &format!("/api/projects/{pid}/agents/{aid}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Bad UUID in path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn bad_uuid_returns_400() {
    let (app, _, _db, _data) = build_test_app();

    let req = json_request("GET", "/api/projects/not-a-uuid", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Dev Loop - no API key
// ---------------------------------------------------------------------------

#[tokio::test]
async fn loop_stop_without_running() {
    let (app, _, _db, _data) = build_test_app();

    let pid = ProjectId::new();
    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Error format consistency
// ---------------------------------------------------------------------------

#[tokio::test]
async fn error_format_has_error_and_code() {
    let (app, _, _db, _data) = build_test_app();

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    let body = response_json(resp).await;

    assert!(body["error"].is_string());
    assert!(body["code"].is_string());
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cors_headers_present() {
    let (app, _, _db, _data) = build_test_app();

    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/projects")
        .header("Origin", "http://localhost:3000")
        .header("Access-Control-Request-Method", "GET")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert!(resp.headers().contains_key("access-control-allow-origin"));
}
