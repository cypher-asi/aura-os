//! Agent cloning creates a new identity through the normal destination
//! creation path and never mutates the source.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{get, post, put};
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
    target_machine_type: &str,
    create_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
    update_capture: Arc<tokio::sync::Mutex<Vec<String>>>,
) -> String {
    let mut source = network_agent_json(source_machine_type, Some("source-vm"));
    source["name"] = Value::String("Source Agent".into());
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

    let created = clone_network_agent(target_machine_type, None);
    let updated = clone_network_agent(target_machine_type, Some("clone-pod"));
    let source_for_get = source.clone();
    let app = Router::new()
        .route(
            "/api/agents/:agent_id",
            get(move |Path(_agent_id): Path<String>| {
                let body = source_for_get.clone();
                async move { Json(body) }
            })
            .merge(put(move |Path(agent_id): Path<String>| {
                let body = updated.clone();
                let capture = update_capture.clone();
                async move {
                    capture.lock().await.push(agent_id);
                    Json(body)
                }
            })),
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

fn clone_network_agent(machine_type: &str, vm_id: Option<&str>) -> Value {
    serde_json::json!({
        "id": CLONE_UUID,
        "name": "source-copy",
        "userId": "u1",
        "orgId": ORG_UUID,
        "role": "architect",
        "personality": "methodical",
        "systemPrompt": "Prefer durable designs.",
        "skills": ["rust", "planning"],
        "machineType": machine_type,
        "vmId": vm_id,
        "permissions": {
            "scope": {},
            "capabilities": [{ "type": "readAgent" }]
        },
        "createdAt": NOW,
        "updatedAt": NOW
    })
}

async fn clone_agent(
    source_machine_type: &str,
    target_machine_type: &str,
) -> (Value, Value, Vec<String>) {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let create_capture = Arc::new(tokio::sync::Mutex::new(None));
    let update_capture = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let network_url = start_clone_network(
        source_machine_type,
        target_machine_type,
        create_capture.clone(),
        update_capture.clone(),
    )
    .await;
    let swarm_url = (target_machine_type == "remote").then(|| async {
        start_mock_swarm(
            StatusCode::OK,
            serde_json::json!({
                "agent_id": CLONE_UUID,
                "status": "running",
                "pod_id": "clone-pod"
            }),
        )
        .await
    });
    let swarm_url = match swarm_url {
        Some(future) => Some(future.await),
        None => None,
    };
    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        swarm_url,
    );

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/clone"),
        Some(serde_json::json!({
            "name": "source-copy",
            "machine_type": target_machine_type,
        })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let response = response_json(resp).await;
    let posted = create_capture.lock().await.clone().expect("new agent POST");
    let updated_agent_ids = update_capture.lock().await.clone();
    (response, posted, updated_agent_ids)
}

#[tokio::test]
async fn clones_every_source_and_destination_machine_type_combination() {
    for source_machine_type in ["local", "remote"] {
        for target_machine_type in ["local", "remote"] {
            let (response, posted, updated_agent_ids) =
                clone_agent(source_machine_type, target_machine_type).await;

            assert_eq!(response["agent"]["agent_id"], CLONE_UUID);
            assert_eq!(response["agent"]["machine_type"], target_machine_type);
            assert_eq!(
                response["agent"]["environment"],
                if target_machine_type == "local" {
                    "local_host"
                } else {
                    "swarm_microvm"
                }
            );
            assert!(response["copy_report"]["copied"]
                .as_array()
                .unwrap()
                .contains(&Value::String("permissions".into())));
            assert!(response["copy_report"]["not_copied"]
                .as_array()
                .unwrap()
                .contains(&Value::String("secrets".into())));

            assert_eq!(posted["name"], "source-copy");
            assert_eq!(posted["machineType"], target_machine_type);
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
            assert!(!updated_agent_ids.contains(&AGENT_UUID.to_string()));
            assert_eq!(
                updated_agent_ids,
                if target_machine_type == "remote" {
                    vec![CLONE_UUID.to_string()]
                } else {
                    Vec::new()
                }
            );
        }
    }
}

#[tokio::test]
async fn rejects_an_unsupported_destination_machine_type() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let create_capture = Arc::new(tokio::sync::Mutex::new(None));
    let update_capture = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let network_url = start_clone_network(
        "remote",
        "local",
        create_capture.clone(),
        update_capture.clone(),
    )
    .await;
    let app = build_app_with_swarm(store, store_dir.path().to_path_buf(), &network_url, None);

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/clone"),
        Some(serde_json::json!({ "machine_type": "spaceship" })),
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(create_capture.lock().await.is_none());
    assert!(update_capture.lock().await.is_empty());
}
