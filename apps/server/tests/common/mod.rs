use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use axum::body::Body;
use axum::extract::{Path, Query};
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::Json;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, Mutex};

use aura_core::*;
use aura_agents::{AgentService, AgentInstanceService};
use aura_auth::AuthService;
use aura_billing::{BillingClient, MeteredLlm, PricingService};
use aura_chat::{ChatService, ChatServiceDeps};
use aura_claude::ClaudeClient;
use aura_engine::EngineEvent;
use aura_network::NetworkClient;
use aura_orbit::OrbitClient;
use aura_orgs::OrgService;
use aura_projects::ProjectService;
use aura_server::state::{AppState, TaskOutputBuffers, TaskStepBuffers};
use aura_sessions::SessionService;
use aura_settings::SettingsService;
use aura_specs::SpecGenerationService;
use aura_store::RocksStore;
use aura_storage::StorageClient;
use aura_tasks::{TaskExtractionService, TaskService};

pub fn store_zero_auth_session(store: &RocksStore) {
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

pub async fn build_test_app_with_mocks() -> (Router, AppState, tempfile::TempDir) {
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
                if q.contains_key("org_id") {
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
        db_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&net_url))),
        Some(Arc::new(StorageClient::with_base_url(&storage_url))),
    );
    (app, state, db_dir)
}

pub fn build_test_app_from_store(
    store: Arc<RocksStore>,
    data_dir: std::path::PathBuf,
    network_client: Option<Arc<NetworkClient>>,
    storage_client: Option<Arc<StorageClient>>,
) -> (Router, AppState) {
    let settings_service = Arc::new(SettingsService::new(store.clone()));
    let billing_client = Arc::new(BillingClient::new());
    let claude_client: Arc<ClaudeClient> = Arc::new(ClaudeClient::new());
    let llm = Arc::new(MeteredLlm::new(claude_client.clone(), billing_client.clone(), store.clone()));
    let org_service = Arc::new(OrgService::new(store.clone()));
    let auth_service = Arc::new(AuthService::new(store.clone()));
    let project_service = Arc::new(ProjectService::new_with_network(network_client.clone(), store.clone()));
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
    let pricing_service = Arc::new(PricingService::new(store.clone()));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone(), pricing_service.clone()));
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
    let chat_service = Arc::new(ChatService::new(ChatServiceDeps {
        store: store.clone(),
        settings: settings_service.clone(),
        llm: llm.clone(),
        spec_gen: spec_gen_service.clone(),
        project_service: project_service.clone(),
        task_service: task_service.clone(),
        storage_client: storage_client.clone(),
    }));

    let (event_tx, _event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(256);
    let task_output_buffers: TaskOutputBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let task_step_buffers: TaskStepBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let state = AppState {
        store,
        data_dir,
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
        task_step_buffers,
        terminal_manager: Arc::new(aura_terminal::TerminalManager::new()),
        network_client,
        storage_client,
        orbit_client: Arc::new(OrbitClient::new()),
        orbit_base_url: None,
        internal_service_token: None,
        runtime_agent_state: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = aura_server::create_router(state.clone());
    (app, state)
}

pub fn build_test_app() -> (Router, AppState, tempfile::TempDir) {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    let (app, state) = build_test_app_from_store(store, db_dir.path().to_path_buf(), None, None);
    (app, state, db_dir)
}

pub fn json_request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
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

pub async fn response_json(response: axum::http::Response<Body>) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}
