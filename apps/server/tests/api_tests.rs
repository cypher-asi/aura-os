use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use axum::body::Body;
use axum::extract::{Path, Query};
use axum::http::{Request, StatusCode};
use axum::routing::{delete, get, post, put};
use axum::Json;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, Mutex};
use tower::ServiceExt;

use aura_core::*;
use aura_agents::{AgentService, AgentInstanceService};
use aura_auth::AuthService;
use aura_billing::{BillingClient, MeteredLlm, PricingService};
use aura_chat::ChatService;
use aura_claude::ClaudeClient;
use aura_engine::EngineEvent;
use aura_network::NetworkClient;
use aura_orbit::OrbitClient;
use aura_orgs::OrgService;
use aura_projects::ProjectService;
use aura_server::state::{AppState, TaskOutputBuffers};
use aura_sessions::SessionService;
use aura_settings::SettingsService;
use aura_specs::SpecGenerationService;
use aura_store::RocksStore;
use aura_storage::StorageClient;
use aura_tasks::{TaskExtractionService, TaskService};

fn store_zero_auth_session(store: &RocksStore) {
    let session = serde_json::to_vec(&ZeroAuthSession {
        user_id: "u1".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Test".into(),
        profile_image: String::new(),
        primary_zid: "zid-1".into(),
        zero_wallet: "w1".into(),
        wallets: vec![],
        access_token: "test-token".into(),
        created_at: chrono::Utc::now(),
        validated_at: chrono::Utc::now(),
    })
    .unwrap();
    store.put_setting("zero_auth_session", &session).unwrap();
}

/// Build app state with optional mock network and storage so project/agent endpoints return 2xx/4xx instead of 503.
async fn build_test_app_with_mocks() -> (Router, AppState, tempfile::TempDir) {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let now = chrono::Utc::now().to_rfc3339();
    let now_put = now.clone();
    let now_list = now.clone();
    let now_post = now.clone();
    let now_put_get = now_put.clone();
    let now_put_put = now_put.clone();
    let created_ids: Arc<StdMutex<HashSet<String>>> = Arc::new(StdMutex::new(HashSet::new()));
    let created_ids_post = created_ids.clone();
    let created_ids_get = created_ids.clone();
    let created_ids_put = created_ids.clone();
    let created_ids_del = created_ids.clone();
    let network_app = Router::new()
        .route(
            "/api/projects",
            get(move |Query(q): Query<std::collections::HashMap<String, String>>| async move {
                if q.get("org_id").is_some() {
                    Json(vec![serde_json::json!({
                        "id": ProjectId::new().to_string(),
                        "name": "Test Project",
                        "description": "A test",
                        "orgId": q.get("org_id").unwrap_or(&String::new()),
                        "folder": ".",
                        "createdAt": now_list,
                        "updatedAt": now_list,
                    })])
                } else {
                    Json(vec![])
                }
            })
            .post(move || {
                let created_ids = created_ids_post.clone();
                let id = ProjectId::new().to_string();
                created_ids.lock().unwrap().insert(id.clone());
                async move {
                    (
                        StatusCode::CREATED,
                        Json(serde_json::json!({
                            "id": id,
                            "name": "Test Project",
                            "description": "A test",
                            "orgId": OrgId::new().to_string(),
                            "folder": ".",
                            "createdAt": now_post,
                            "updatedAt": now_post,
                        })),
                    )
                }
            }),
        )
        .route(
            "/api/projects/:project_id",
            get(move |Path(project_id): Path<String>| {
                let created_ids = created_ids_get.clone();
                let now_put = now_put_get.clone();
                async move {
                    if created_ids.lock().unwrap().contains(&project_id) {
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({
                                "id": project_id,
                                "name": "Test Project",
                                "description": "A test",
                                "orgId": "",
                                "folder": ".",
                                "createdAt": now_put,
                                "updatedAt": now_put,
                            })),
                        )
                    } else {
                        (
                            StatusCode::NOT_FOUND,
                            Json(serde_json::json!({"error": "project not found"})),
                        )
                    }
                }
            })
            .put(move |Path(project_id): Path<String>| {
                let created_ids = created_ids_put.clone();
                async move {
                    if created_ids.lock().unwrap().contains(&project_id) {
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({
                                "id": "",
                                "name": "Updated Name",
                                "description": "",
                                "orgId": "",
                                "folder": ".",
                                "createdAt": now_put_put,
                                "updatedAt": now_put_put,
                            })),
                        )
                    } else {
                        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not found"})))
                    }
                }
            })
            .delete(move |Path(project_id): Path<String>| {
                let created_ids = created_ids_del.clone();
                async move {
                    created_ids.lock().unwrap().remove(&project_id);
                    StatusCode::NO_CONTENT
                }
            }),
        );
    let net_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let net_addr = net_listener.local_addr().unwrap();
    let net_url = format!("http://{}", net_addr);
    tokio::spawn(async move { axum::serve(net_listener, network_app).await.ok() });

    let storage_app = Router::new()
        .route(
            "/api/projects/:project_id/agents",
            get(|| async { Json::<Vec<Value>>(vec![]) }),
        )
        .route(
            "/api/project-agents/:id",
            get(|Path(_id): Path<String>| async {
                (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "not found"})))
            }),
        );
    let storage_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage_addr = storage_listener.local_addr().unwrap();
    let storage_url = format!("http://{}", storage_addr);
    tokio::spawn(async move { axum::serve(storage_listener, storage_app).await.ok() });

    let (app, state) = build_test_app_from_store(
        store.clone(),
        Some(Arc::new(NetworkClient::with_base_url(&net_url))),
        Some(Arc::new(StorageClient::with_base_url(&storage_url))),
    );
    (app, state, db_dir)
}

fn build_test_app_from_store(
    store: Arc<RocksStore>,
    network_client: Option<Arc<NetworkClient>>,
    storage_client: Option<Arc<StorageClient>>,
) -> (Router, AppState) {
    let settings_service = Arc::new(SettingsService::new(store.clone()));
    let billing_client = Arc::new(BillingClient::new());
    let claude_client: Arc<ClaudeClient> = Arc::new(ClaudeClient::new());
    let llm = Arc::new(MeteredLlm::new(claude_client.clone(), billing_client.clone(), store.clone()));
    let org_service = Arc::new(OrgService::new(store.clone()));
    let auth_service = Arc::new(AuthService::new(store.clone()));
    let project_service = Arc::new(ProjectService::new(network_client.clone(), store.clone()));
    let spec_gen_service = Arc::new(SpecGenerationService::new(
        store.clone(),
        project_service.clone(),
        settings_service.clone(),
        llm.clone(),
        None,
    ));
    let task_extraction_service = Arc::new(TaskExtractionService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
        None,
    ));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone()));
    let pricing_service = Arc::new(PricingService::new(store.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone(), network_client.clone()));
    let runtime_agent_state: aura_server::state::RuntimeAgentStateMap =
        Arc::new(Mutex::new(HashMap::new()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(
        store.clone(),
        storage_client.clone(),
        runtime_agent_state.clone(),
        network_client.clone(),
    ));
    let llm_config = LlmConfig::default();
    let session_service = Arc::new(SessionService::new(
        store.clone(),
        llm_config.context_rollover_threshold,
        llm_config.max_context_tokens,
    ));
    let chat_service = Arc::new(ChatService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
        spec_gen_service.clone(),
        project_service.clone(),
        task_service.clone(),
        storage_client.clone(),
    ));

    let (event_tx, _event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(256);
    let task_output_buffers: TaskOutputBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let state = AppState {
        store,
        org_service,
        auth_service,
        settings_service,
        pricing_service,
        billing_client,
        project_service,
        spec_gen_service,
        task_extraction_service,
        task_service,
        agent_service,
        agent_instance_service,
        session_service,
        chat_service,
        llm,
        event_tx,
        event_broadcast,
        loop_registry: Arc::new(Mutex::new(HashMap::new())),
        write_coordinator: aura_engine::ProjectWriteCoordinator::new(),
        task_output_buffers,
        terminal_manager: Arc::new(aura_terminal::TerminalManager::new()),
        network_client,
        storage_client,
        orbit_client: Arc::new(OrbitClient::new()),
        orbit_base_url: None,
        runtime_agent_state: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = aura_server::create_router(state.clone());
    (app, state)
}

fn build_test_app() -> (Router, AppState, tempfile::TempDir) {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    let (app, state) = build_test_app_from_store(store, None, None);
    (app, state, db_dir)
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
    let (app, _, _db) = build_test_app();

    // GET returns ApiKeyInfo { configured: bool }.
    let req = json_request("GET", "/api/settings/api-key", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body["configured"].is_boolean(), "expected configured field: {}", body);
}

// ---------------------------------------------------------------------------
// Project Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_crud() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    // Create a temp dir for the project linked folder
    let project_dir = tempfile::tempdir().unwrap();

    // Create
    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
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

    // List (org-scoped; no org_id returns empty)
    let req = json_request(
        "GET",
        &format!("/api/projects?org_id={}", org_id),
        None,
    );
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

    // Archive (returns project from network; archive status not yet supported on network)
    let req = json_request("POST", &format!("/api/projects/{project_id}/archive"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body.get("project_id").is_some() || body.get("name").is_some());
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

// task_list_and_progress test removed -- requires seeding tasks via local RocksDB
// which was removed in Phase 5e. Will be rewritten with aura-storage mock in Phase 9e.

// ---------------------------------------------------------------------------
// Agent Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_list_empty() {
    let (app, _state, _db) = build_test_app_with_mocks().await;

    let pid = ProjectId::new();
    // Project agents come from storage only; mock storage returns empty list.
    let req = json_request("GET", &format!("/api/projects/{pid}/agents"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn agent_not_found() {
    let (app, _, _db) = build_test_app_with_mocks().await;

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
    let (app, _, _db) = build_test_app();

    let req = json_request("GET", "/api/projects/not-a-uuid", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Dev Loop - no API key
// ---------------------------------------------------------------------------

#[tokio::test]
async fn loop_stop_without_running() {
    let (app, _, _db) = build_test_app();

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
    let (app, _, _db) = build_test_app();

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
    let (app, _, _db) = build_test_app();

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
