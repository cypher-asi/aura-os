//! Remote-to-local cloning: creates a second identity and never mutates the
//! remote source.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::*;

const CLONE_UUID: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async fn start_clone_network(
    source_machine_type: &str,
    create_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let mut source = network_agent_json(source_machine_type, Some("source-vm"));
    source["name"] = Value::String("Remote Source".into());
    source["role"] = Value::String("architect".into());
    source["personality"] = Value::String("methodical".into());
    source["systemPrompt"] = Value::String("Prefer durable designs.".into());
    source["skills"] = serde_json::json!(["rust", "planning"]);
    source["orgId"] = Value::String(ORG_UUID.into());
    source["tags"] =
        serde_json::json!(["custom:kept", "listing_status:hireable", "expertise:coding"]);
    source["listingStatus"] = Value::String("hireable".into());
    source["expertise"] = serde_json::json!(["coding"]);
    source["walletAddress"] = Value::String("0xsource".into());
    source["permissions"] = serde_json::json!({
        "scope": {},
        "capabilities": [{ "type": "readAgent" }]
    });

    let created = serde_json::json!({
        "id": CLONE_UUID,
        "name": "remote-copy",
        "userId": "u1",
        "orgId": ORG_UUID,
        "role": "architect",
        "personality": "methodical",
        "systemPrompt": "Prefer durable designs.",
        "skills": ["rust", "planning"],
        "machineType": "local",
        "permissions": {
            "scope": {},
            "capabilities": [{ "type": "readAgent" }]
        },
        "createdAt": NOW,
        "updatedAt": NOW
    });

    let source_for_get = source.clone();
    let app = Router::new()
        .route(
            "/api/agents/:agent_id",
            get(move |Path(_agent_id): Path<String>| {
                let body = source_for_get.clone();
                async move { Json(body) }
            }),
        )
        .route(
            "/api/agents",
            post(move |Json(body): Json<Value>| {
                let capture = create_capture.clone();
                let created = created.clone();
                async move {
                    *capture.lock().await = Some(body);
                    (StatusCode::CREATED, Json(created))
                }
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{addr}")
}

#[tokio::test]
async fn clone_remote_to_local_creates_a_second_agent_with_safe_copy_boundary() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let create_capture = Arc::new(tokio::sync::Mutex::new(None));
    let network_url = start_clone_network("remote", create_capture.clone()).await;
    let app = build_app_with_swarm(store, store_dir.path().to_path_buf(), &network_url, None);

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/clone-to-local"),
        Some(serde_json::json!({ "name": "remote-copy" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let response = response_json(resp).await;
    assert_eq!(response["source_agent_id"], AGENT_UUID);
    assert_eq!(response["source_preserved"], true);
    assert_eq!(response["agent"]["agent_id"], CLONE_UUID);
    assert_eq!(response["agent"]["machine_type"], "local");
    assert_eq!(response["agent"]["environment"], "local_host");
    assert!(response["copy_report"]["copied"]
        .as_array()
        .unwrap()
        .contains(&Value::String("permissions".into())));
    assert!(response["copy_report"]["not_copied"]
        .as_array()
        .unwrap()
        .contains(&Value::String("secrets".into())));

    let posted = create_capture.lock().await.clone().expect("new agent POST");
    assert_eq!(posted["name"], "remote-copy");
    assert_eq!(posted["machineType"], "local");
    assert_eq!(posted["listingStatus"], "closed");
    assert_eq!(posted["expertise"], serde_json::json!([]));
    assert_eq!(
        posted["permissions"]["capabilities"],
        serde_json::json!([{ "type": "readAgent" }])
    );
    let tags = posted["tags"].as_array().unwrap();
    assert!(tags.contains(&Value::String("custom:kept".into())));
    assert!(tags.contains(&Value::String(format!("cloned_from_agent:{AGENT_UUID}"))));
    assert!(!tags.contains(&Value::String("listing_status:hireable".into())));
    assert!(!tags.contains(&Value::String("expertise:coding".into())));
}

#[tokio::test]
async fn clone_rejects_a_local_source_without_creating_an_agent() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let create_capture = Arc::new(tokio::sync::Mutex::new(None));
    let network_url = start_clone_network("local", create_capture.clone()).await;
    let app = build_app_with_swarm(store, store_dir.path().to_path_buf(), &network_url, None);

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/clone-to-local"),
        Some(serde_json::json!({})),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(create_capture.lock().await.is_none());
}
