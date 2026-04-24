use std::collections::HashMap;
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
use tokio::sync::{broadcast, Mutex};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_core::*;
use aura_os_harness::{AutomatonClient, HarnessLink, LocalHarness, SwarmHarness};
use aura_os_network::NetworkClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_server::AppState;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use aura_os_tasks::TaskService;

pub fn store_zero_auth_session(store: &SettingsStore) {
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
        is_zero_pro: true,
        is_access_granted: false,
        created_at: chrono::Utc::now(),
        validated_at: chrono::Utc::now(),
    })
    .unwrap();
    store.put_setting("zero_auth_session", &session).unwrap();
}

#[allow(dead_code)]
pub async fn build_test_app_with_storage(
) -> (Router, AppState, Arc<StorageClient>, tempfile::TempDir) {
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(StorageClient::with_base_url(&storage_url));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        Some(storage.clone()),
        None,
        None,
    );
    (app, state, storage, store_dir)
}

#[allow(dead_code)]
pub async fn build_test_app_with_mocks() -> (Router, AppState, tempfile::TempDir) {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let now = chrono::Utc::now().to_rfc3339();
    let now_put = now.clone();
    let now_list = now.clone();
    let now_post = now.clone();
    let now_put_get = now_put.clone();
    let now_put_put = now_put.clone();
    let created_ids: Arc<StdMutex<HashMap<String, String>>> =
        Arc::new(StdMutex::new(HashMap::new()));
    let created_ids_post = created_ids.clone();
    let created_ids_get = created_ids.clone();
    let created_ids_put = created_ids.clone();
    let created_ids_del = created_ids.clone();
    let network_app = Router::new()
        .route(
            "/api/projects",
            get(
                move |Query(q): Query<std::collections::HashMap<String, String>>| async move {
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
                },
            )
            .post(move || {
                let created_ids = created_ids_post.clone();
                let id = ProjectId::new().to_string();
                let org_id = OrgId::new().to_string();
                created_ids
                    .lock()
                    .unwrap()
                    .insert(id.clone(), org_id.clone());
                async move {
                    (
                        StatusCode::CREATED,
                        Json(serde_json::json!({
                            "id": id,
                            "name": "Test Project",
                            "description": "A test",
                            "orgId": org_id,
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
                    let org_id = created_ids.lock().unwrap().get(&project_id).cloned();
                    if let Some(org_id) = org_id {
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({
                                "id": project_id,
                                "name": "Test Project",
                                "description": "A test",
                                "orgId": org_id,
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
                    let org_id = created_ids.lock().unwrap().get(&project_id).cloned();
                    if let Some(org_id) = org_id {
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({
                                "id": project_id,
                                "name": "Updated Name",
                                "description": "",
                                "orgId": org_id,
                                "folder": ".",
                                "createdAt": now_put_put,
                                "updatedAt": now_put_put,
                            })),
                        )
                    } else {
                        (
                            StatusCode::NOT_FOUND,
                            Json(serde_json::json!({"error": "not found"})),
                        )
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
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": "not found"})),
                )
            }),
        );
    let storage_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage_addr = storage_listener.local_addr().unwrap();
    let storage_url = format!("http://{}", storage_addr);
    tokio::spawn(async move { axum::serve(storage_listener, storage_app).await.ok() });

    let (app, state) = build_test_app_from_store(
        store.clone(),
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&net_url))),
        Some(Arc::new(StorageClient::with_base_url(&storage_url))),
        None,
        None,
    );
    (app, state, store_dir)
}

pub fn build_test_app_from_store(
    store: Arc<SettingsStore>,
    data_dir: std::path::PathBuf,
    network_client: Option<Arc<NetworkClient>>,
    storage_client: Option<Arc<StorageClient>>,
    swarm_base_url: Option<String>,
    billing_client: Option<Arc<BillingClient>>,
) -> (Router, AppState) {
    let billing_client = billing_client.unwrap_or_else(|| Arc::new(BillingClient::new()));
    let org_service = Arc::new(OrgService::new(store.clone()));
    let auth_service = Arc::new(AuthService::new());
    let project_service = Arc::new(ProjectService::new_with_network(
        network_client.clone(),
        store.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone(), network_client.clone()));
    let runtime_agent_state: aura_os_agents::RuntimeAgentStateMap =
        Arc::new(Mutex::new(HashMap::new()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(
        store.clone(),
        storage_client.clone(),
        runtime_agent_state,
        network_client.clone(),
    ));
    let session_service = Arc::new(SessionService::new(store.clone(), 0.8, 200_000));

    let swarm_harness: Arc<dyn HarnessLink> = Arc::new(SwarmHarness::new(
        "http://localhost:19800".to_string(),
        None,
    ));
    let harness_base =
        std::env::var("LOCAL_HARNESS_URL").unwrap_or_else(|_| "http://localhost:19080".to_string());
    let local_harness: Arc<dyn HarnessLink> = Arc::new(LocalHarness::new(harness_base.clone()));

    let (event_broadcast, _) = broadcast::channel::<serde_json::Value>(256);
    let automaton_client = Arc::new(AutomatonClient::new(&harness_base));
    let harness_http = Arc::new(aura_os_server::HarnessHttpGateway::new(harness_base));
    let validation_cache = Arc::new(dashmap::DashMap::new());
    validation_cache.insert(
        TEST_JWT.to_string(),
        aura_os_server::CachedSession {
            session: ZeroAuthSession {
                user_id: "u1".into(),
                network_user_id: None,
                profile_id: None,
                display_name: "Test".into(),
                profile_image: String::new(),
                primary_zid: "zid-1".into(),
                zero_wallet: "w1".into(),
                wallets: vec![],
                access_token: TEST_JWT.into(),
                is_zero_pro: true,
                is_access_granted: false,
                created_at: chrono::Utc::now(),
                validated_at: chrono::Utc::now(),
            },
            validated_at: std::time::Instant::now(),
            zero_pro_refresh_error: None,
        },
    );

    let router_url = "http://localhost:19080".to_string();
    let agent_event_listener = Arc::new(aura_os_server::agent_events::AgentEventListener::new(100));
    agent_event_listener.spawn(event_broadcast.subscribe());

    let loop_log = Arc::new(aura_os_server::loop_log::LoopLogWriter::new(
        data_dir.join("loop_logs"),
    ));
    let state = AppState {
        store,
        data_dir,
        org_service,
        auth_service,
        billing_client,
        project_service,
        task_service,
        agent_service,
        agent_instance_service,
        session_service,
        local_harness,
        swarm_harness,
        harness_sessions: Arc::new(Mutex::new(HashMap::new())),
        chat_sessions: Arc::new(Mutex::new(HashMap::new())),
        credit_cache: Arc::new(Mutex::new(HashMap::new())),
        event_broadcast,
        terminal_manager: Arc::new(aura_os_terminal::TerminalManager::new()),
        browser_manager: Arc::new(aura_os_browser::BrowserManager::new(
            aura_os_browser::BrowserConfig::default(),
        )),
        feedback_network_client: network_client.clone(),
        network_client,
        storage_client,
        integrations_client: None,
        require_zero_pro: false,
        automaton_client,
        harness_http,
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        swarm_base_url,
        task_output_cache: Arc::new(Mutex::new(HashMap::new())),
        orbit_client: None,
        validation_cache,
        agent_discovery_cache: Arc::new(dashmap::DashMap::new()),
        router_url,
        http_client: reqwest::Client::new(),
        agent_event_listener,
        loop_log,
        orbit_capacity_guard: Arc::new(aura_os_server::orbit_guard::OrbitCapacityGuard::new()),
    };

    let app = aura_os_server::create_router_with_interface(state.clone(), None);
    (app, state)
}

#[allow(dead_code)]
pub fn build_test_app() -> (Router, AppState, tempfile::TempDir) {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        None,
        None,
        None,
    );
    (app, state, store_dir)
}

#[allow(dead_code)]
pub fn build_test_app_with_billing_client(
    billing_client: Arc<BillingClient>,
) -> (Router, AppState, tempfile::TempDir) {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        None,
        None,
        Some(billing_client),
    );
    (app, state, store_dir)
}

pub const TEST_JWT: &str = "test-token";

pub fn json_request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {}", TEST_JWT));

    match body {
        Some(b) => builder
            .body(Body::from(serde_json::to_vec(&b).unwrap()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

#[allow(dead_code)]
pub async fn response_json(response: axum::http::Response<Body>) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}
