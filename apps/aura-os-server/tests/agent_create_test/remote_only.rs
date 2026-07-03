//! Remote-only deployment backstops that span bootstrap, project binding,
//! and chat routes.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_core::{Agent, AgentId, AgentPermissions, ProjectId};
use aura_os_network::NetworkClient;
use aura_os_storage::{CreateProjectAgentRequest, StorageClient};
use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::*;

const ORG_UUID: &str = "99999999-8888-7777-6666-555555555555";

fn local_agent(agent_id: AgentId) -> Agent {
    let now = chrono::Utc::now();
    Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Local".into(),
        role: "dev".into(),
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
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

async fn start_mock_network_get_404() -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(|| async {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not found" })),
            )
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

async fn start_mock_network_get_local(agent_id: AgentId) -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move |Path(_agent_id): Path<String>| {
            let agent_id = agent_id.to_string();
            async move {
                Json(serde_json::json!({
                    "id": agent_id,
                    "name": "Local",
                    "role": "dev",
                    "userId": "u1",
                    "machineType": "local",
                    "createdAt": NOW,
                    "updatedAt": NOW
                }))
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

async fn start_mock_network_for_ceo_setup(
    vm_id_for_update: String,
    create_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let create_agent = network_agent_json("remote", None);
    let create_agent_for_post = create_agent.clone();
    let app = Router::new()
        .route(
            "/api/agents",
            get(|| async { Json(Vec::<Value>::new()) }).post(move |Json(body): Json<Value>| {
                let capture = create_capture.clone();
                let agent = create_agent_for_post.clone();
                async move {
                    *capture.lock().await = Some(body);
                    (StatusCode::CREATED, Json(agent))
                }
            }),
        )
        .route(
            "/api/agents/:agent_id",
            get(move |Path(_agent_id): Path<String>| {
                let agent = create_agent.clone();
                async move { Json(agent) }
            })
            .put(
                move |Path(_agent_id): Path<String>, Json(_body): Json<Value>| {
                    let vm = vm_id_for_update.clone();
                    async move {
                        let mut updated = network_agent_json("remote", Some(&vm));
                        updated["name"] = Value::String("CEO".to_string());
                        updated["role"] = Value::String("CEO".to_string());
                        Json(updated)
                    }
                },
            ),
        )
        .route(
            "/api/orgs",
            get(|| async {
                Json(vec![serde_json::json!({
                    "id": ORG_UUID,
                    "name": "Test Org",
                    "ownerUserId": "u1"
                })])
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

async fn start_mock_network_with_existing_local_ceo(
    vm_id_for_update: String,
    update_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let mut local_ceo = network_agent_json("local", None);
    local_ceo["name"] = Value::String("CEO".to_string());
    local_ceo["role"] = Value::String("CEO".to_string());
    local_ceo["orgId"] = Value::String(ORG_UUID.to_string());
    let local_ceo_for_list = local_ceo.clone();
    let local_ceo_for_get = local_ceo.clone();
    let app = Router::new()
        .route(
            "/api/agents",
            get(move || {
                let agent = local_ceo_for_list.clone();
                async move { Json(vec![agent]) }
            }),
        )
        .route(
            "/api/agents/:agent_id",
            get(move |Path(_agent_id): Path<String>| {
                let agent = local_ceo_for_get.clone();
                async move { Json(agent) }
            })
            .put(
                move |Path(_agent_id): Path<String>, Json(body): Json<Value>| {
                    let capture = update_capture.clone();
                    let vm = vm_id_for_update.clone();
                    async move {
                        *capture.lock().await = Some(body);
                        let mut updated = network_agent_json("remote", Some(&vm));
                        updated["name"] = Value::String("CEO".to_string());
                        updated["role"] = Value::String("CEO".to_string());
                        updated["orgId"] = Value::String(ORG_UUID.to_string());
                        Json(updated)
                    }
                },
            ),
        )
        .route(
            "/api/orgs",
            get(|| async {
                Json(vec![serde_json::json!({
                    "id": ORG_UUID,
                    "name": "Test Org",
                    "ownerUserId": "u1"
                })])
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

#[tokio::test]
async fn remote_only_ceo_setup_creates_remote_agent() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let create_capture = Arc::new(tokio::sync::Mutex::new(None));
    let network_url =
        start_mock_network_for_ceo_setup("pod-ceo-123".to_string(), create_capture.clone()).await;
    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-ceo-123"
        }),
    )
    .await;
    let (app, _state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        None,
        Some(swarm_url),
        None,
        true,
    );

    let resp = app
        .oneshot(json_request("POST", "/api/agents/harness/setup", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["created"], true);
    assert_eq!(body["agent"]["machine_type"], "remote");
    assert_eq!(body["agent"]["environment"], "swarm_microvm");
    assert_eq!(body["agent"]["vm_id"], "pod-ceo-123");

    let captured = create_capture.lock().await;
    let create_body = captured
        .as_ref()
        .expect("CEO setup should create an aura-network agent");
    assert_eq!(create_body["machineType"], "remote");
}

#[tokio::test]
async fn remote_only_ceo_setup_rehomes_existing_local_ceo() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture = Arc::new(tokio::sync::Mutex::new(None));
    let network_url = start_mock_network_with_existing_local_ceo(
        "pod-ceo-existing".to_string(),
        update_capture.clone(),
    )
    .await;
    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-ceo-existing"
        }),
    )
    .await;
    let (app, _state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        None,
        Some(swarm_url),
        None,
        true,
    );

    let resp = app
        .oneshot(json_request("POST", "/api/agents/harness/setup", None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["created"], false);
    assert_eq!(body["agent"]["machine_type"], "remote");
    assert_eq!(body["agent"]["environment"], "swarm_microvm");
    assert_eq!(body["agent"]["vm_id"], "pod-ceo-existing");

    let captured = update_capture.lock().await;
    let update_body = captured
        .as_ref()
        .expect("existing local CEO should be patched to remote");
    assert_eq!(update_body["machineType"], "remote");
    assert_eq!(update_body["vmId"], "pod-ceo-existing");
    assert_eq!(update_body["orgId"], ORG_UUID);
}

#[tokio::test]
async fn remote_only_general_agent_instance_provisions_remote_agent() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let update_capture = Arc::new(tokio::sync::Mutex::new(None));
    let network_url = start_mock_network_with_update(
        network_agent_json("remote", None),
        "pod-general-123".to_string(),
        update_capture.clone(),
    )
    .await;
    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-general-123"
        }),
    )
    .await;
    let (app, _state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        Some(Arc::new(StorageClient::with_base_url(&storage_url))),
        Some(swarm_url),
        None,
        true,
    );

    let project_id = ProjectId::new();
    let resp = app
        .oneshot(json_request(
            "POST",
            &format!("/api/projects/{project_id}/agents"),
            Some(serde_json::json!({ "kind": "general" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["machine_type"], "remote");
    assert_eq!(body["environment"], "swarm_microvm");

    let captured = update_capture.lock().await;
    assert!(
        captured.is_some(),
        "remote general agent should be provisioned and written back to aura-network"
    );
}

#[tokio::test]
async fn remote_only_rejects_existing_local_agent_project_binding() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (storage_url, db) = aura_os_storage::testutil::start_mock_storage().await;
    let agent_id = AgentId::new();
    let network_url = start_mock_network_get_local(agent_id).await;
    let (app, state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        Some(Arc::new(StorageClient::with_base_url(&storage_url))),
        None,
        None,
        true,
    );

    state
        .agent_service
        .save_agent_shadow(&local_agent(agent_id))
        .unwrap();

    let project_id = ProjectId::new();
    let resp = app
        .oneshot(json_request(
            "POST",
            &format!("/api/projects/{project_id}/agents"),
            Some(serde_json::json!({ "agent_id": agent_id })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert!(body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("local agents are not supported"));
    assert!(
        db.lock().await.project_agents.is_empty(),
        "rejected local binding must not reach aura-storage"
    );
}

#[tokio::test]
async fn remote_only_instance_chat_rejects_local_agent_before_persistence() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(StorageClient::with_base_url(&storage_url));
    let network_url = start_mock_network_get_404().await;
    let (app, state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        Some(storage.clone()),
        None,
        None,
        true,
    );

    let project_id = ProjectId::new();
    let agent_id = AgentId::new();
    let agent = local_agent(agent_id);
    state.agent_service.save_agent_shadow(&agent).unwrap();
    let project_agent = storage
        .create_project_agent(
            &project_id.to_string(),
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: agent.name,
                org_id: None,
                role: Some(agent.role),
                personality: Some(agent.personality),
                system_prompt: Some(agent.system_prompt),
                skills: Some(agent.skills),
                icon: None,
                harness: None,
                instance_role: Some("chat".into()),
                source: Some("ui".into()),
                permissions: Some(AgentPermissions::empty()),
                intent_classifier: None,
            },
        )
        .await
        .unwrap();

    let resp = app
        .oneshot(json_request(
            "POST",
            &format!(
                "/api/projects/{project_id}/agents/{}/events/stream",
                project_agent.id
            ),
            Some(serde_json::json!({ "content": "ping" })),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert!(body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("desktop app"));
}
