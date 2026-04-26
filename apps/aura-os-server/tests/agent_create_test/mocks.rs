//! Helpers for building mock aura-network and aura-swarm endpoints used by
//! the agent-create / agent-recover integration tests.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;

use aura_os_network::NetworkClient;
use aura_os_store::SettingsStore;

use super::common::*;

pub(crate) const AGENT_UUID: &str = "00000000-1111-2222-3333-444444444444";
pub(crate) const NOW: &str = "2024-01-01T00:00:00Z";

pub(crate) fn network_agent_json(machine_type: &str, vm_id: Option<&str>) -> Value {
    serde_json::json!({
        "id": AGENT_UUID,
        "name": "Test Agent",
        "userId": "u1",
        "machineType": machine_type,
        "vmId": vm_id,
        "createdAt": NOW,
        "updatedAt": NOW,
    })
}

pub(crate) fn create_agent_body(machine_type: &str) -> Value {
    serde_json::json!({
        "name": "test-agent",
        "role": "developer",
        "personality": "helpful",
        "system_prompt": "You are a test agent.",
        "skills": [],
        "machine_type": machine_type,
        "permissions": {},
    })
}

/// Starts a mock network that only handles POST /api/agents (create)
/// and returns the given agent JSON. No PUT support.
pub(crate) async fn start_mock_network_create_only(agent_json: Value) -> String {
    let app = Router::new().route(
        "/api/agents",
        post(move || {
            let j = agent_json.clone();
            async move { (StatusCode::CREATED, Json(j)) }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock network with POST /api/agents and PUT /api/agents/:id.
/// The PUT handler returns the agent with the given `vm_id` set.
/// `update_capture` receives the body of the PUT request for assertions.
pub(crate) async fn start_mock_network_with_update(
    create_json: Value,
    vm_id_for_update: String,
    update_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let create_json_clone = create_json.clone();
    let app = Router::new()
        .route(
            "/api/agents",
            post(move || {
                let j = create_json_clone.clone();
                async move { (StatusCode::CREATED, Json(j)) }
            }),
        )
        .route(
            "/api/agents/:agent_id",
            axum::routing::put(
                move |Path(_agent_id): Path<String>, Json(body): Json<Value>| {
                    let capture = update_capture.clone();
                    let vm = vm_id_for_update.clone();
                    async move {
                        *capture.lock().await = Some(body);
                        let mut updated = network_agent_json("remote", Some(&vm));
                        updated["vmId"] = Value::String(vm);
                        Json(updated)
                    }
                },
            ),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

pub(crate) async fn start_mock_network_get_only(agent_json: Value) -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move |Path(_agent_id): Path<String>| {
            let j = agent_json.clone();
            async move { Json(j) }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

pub(crate) async fn start_mock_network_get_with_update(
    agent_json: Value,
    vm_id_for_update: String,
    update_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let agent_json_clone = agent_json.clone();
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move |Path(_agent_id): Path<String>| {
            let j = agent_json_clone.clone();
            async move { Json(j) }
        })
        .put(
            move |Path(_agent_id): Path<String>, Json(body): Json<Value>| {
                let capture = update_capture.clone();
                let vm = vm_id_for_update.clone();
                async move {
                    *capture.lock().await = Some(body);
                    let mut updated = network_agent_json("remote", Some(&vm));
                    updated["vmId"] = Value::String(vm);
                    Json(updated)
                }
            },
        ),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock swarm gateway on a random port. Returns the base URL.
/// Handles POST /v1/agents (provision) and DELETE /v1/agents/:id (delete).
pub(crate) async fn start_mock_swarm(status_code: StatusCode, body: Value) -> String {
    let app = Router::new()
        .route(
            "/v1/agents",
            post(move || {
                let b = body.clone();
                let sc = status_code;
                async move { (sc, Json(b)) }
            }),
        )
        .route(
            "/v1/agents/:agent_id",
            axum::routing::delete(|Path(_id): Path<String>| async { StatusCode::OK }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock swarm where DELETE returns one status and POST returns another.
pub(crate) async fn start_mock_swarm_with_delete(
    delete_status: StatusCode,
    provision_status: StatusCode,
    provision_body: Value,
) -> String {
    let app = Router::new()
        .route(
            "/v1/agents",
            post(move || {
                let b = provision_body.clone();
                let sc = provision_status;
                async move { (sc, Json(b)) }
            }),
        )
        .route(
            "/v1/agents/:agent_id",
            axum::routing::delete(move |Path(_id): Path<String>| {
                let sc = delete_status;
                async move { sc }
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock swarm gateway that returns a raw string body (for malformed JSON test).
pub(crate) async fn start_mock_swarm_raw(status_code: StatusCode, raw_body: String) -> String {
    let app = Router::new().route(
        "/v1/agents",
        post(move || {
            let b = raw_body.clone();
            let sc = status_code;
            async move {
                (
                    sc,
                    [(axum::http::header::CONTENT_TYPE, "application/json")],
                    b,
                )
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

pub(crate) fn build_app_with_swarm(
    store: Arc<SettingsStore>,
    data_dir: std::path::PathBuf,
    network_url: &str,
    swarm_url: Option<String>,
) -> axum::Router {
    let (app, _state) = build_test_app_from_store(
        store,
        data_dir,
        Some(Arc::new(NetworkClient::with_base_url(network_url))),
        None,
        swarm_url,
        None,
    );
    app
}
