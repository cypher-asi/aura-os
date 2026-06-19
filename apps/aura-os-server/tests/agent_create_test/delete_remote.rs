//! Remote agent deletion must release the swarm-side machine before removing
//! the Aura/network record, otherwise stale swarm records can keep org quota
//! exhausted even after the agent disappears from Aura.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::Json;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::*;

#[tokio::test]
async fn delete_remote_agent_deletes_swarm_before_network_record() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let calls = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let network_url = start_mock_network_get_delete(
        network_agent_json("remote", Some("pod-abc-123")),
        calls.clone(),
    )
    .await;
    let swarm_url = start_mock_swarm_delete(calls.clone()).await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("DELETE", &format!("/api/agents/{AGENT_UUID}"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let calls = calls.lock().await;
    assert_eq!(
        calls.as_slice(),
        [
            format!("network-get:{AGENT_UUID}"),
            format!("swarm-delete:{AGENT_UUID}"),
            format!("network-delete:{AGENT_UUID}"),
        ],
    );
}

#[tokio::test]
async fn delete_remote_agent_stops_running_swarm_agent_before_delete_retry() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let calls = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let network_url = start_mock_network_get_delete(
        network_agent_json("remote", Some("pod-abc-123")),
        calls.clone(),
    )
    .await;
    let swarm_url = start_mock_swarm_delete_requires_stop(calls.clone()).await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("DELETE", &format!("/api/agents/{AGENT_UUID}"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let calls = calls.lock().await;
    assert_eq!(
        calls.as_slice(),
        [
            format!("network-get:{AGENT_UUID}"),
            format!("swarm-delete:{AGENT_UUID}:1"),
            format!("swarm-stop:{AGENT_UUID}"),
            format!("swarm-delete:{AGENT_UUID}:2"),
            format!("network-delete:{AGENT_UUID}"),
        ],
    );
}

async fn start_mock_network_get_delete(
    agent_json: serde_json::Value,
    calls: Arc<tokio::sync::Mutex<Vec<String>>>,
) -> String {
    let get_agent_json = agent_json.clone();
    let get_calls = calls.clone();
    let delete_calls = calls.clone();
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move |Path(agent_id): Path<String>| {
            let j = get_agent_json.clone();
            let calls = get_calls.clone();
            async move {
                calls.lock().await.push(format!("network-get:{agent_id}"));
                Json(j)
            }
        })
        .delete(move |Path(agent_id): Path<String>| {
            let calls = delete_calls.clone();
            async move {
                calls
                    .lock()
                    .await
                    .push(format!("network-delete:{agent_id}"));
                StatusCode::OK
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

async fn start_mock_swarm_delete_requires_stop(
    calls: Arc<tokio::sync::Mutex<Vec<String>>>,
) -> String {
    let delete_attempts = Arc::new(tokio::sync::Mutex::new(0_u8));
    let delete_calls = calls.clone();
    let delete_attempts_for_route = delete_attempts.clone();
    let stop_calls = calls.clone();
    let app = Router::new()
        .route(
            "/v1/agents/:agent_id",
            delete(move |Path(agent_id): Path<String>| {
                let calls = delete_calls.clone();
                let attempts = delete_attempts_for_route.clone();
                async move {
                    let mut attempts = attempts.lock().await;
                    *attempts += 1;
                    calls
                        .lock()
                        .await
                        .push(format!("swarm-delete:{agent_id}:{}", *attempts));
                    if *attempts == 1 {
                        return (
                            StatusCode::CONFLICT,
                            Json(serde_json::json!({
                                "error": {
                                    "code": "conflict",
                                    "message": "conflict: cannot transition from Running to Stopped"
                                }
                            })),
                        );
                    }
                    (StatusCode::NO_CONTENT, Json(serde_json::json!({})))
                }
            }),
        )
        .route(
            "/v1/agents/:agent_id/stop",
            post(move |Path(agent_id): Path<String>| {
                let calls = stop_calls.clone();
                async move {
                    calls.lock().await.push(format!("swarm-stop:{agent_id}"));
                    Json(serde_json::json!({
                        "agent_id": agent_id,
                        "status": "stopping"
                    }))
                }
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

async fn start_mock_swarm_delete(calls: Arc<tokio::sync::Mutex<Vec<String>>>) -> String {
    let app = Router::new().route(
        "/v1/agents/:agent_id",
        delete(move |Path(agent_id): Path<String>| {
            let calls = calls.clone();
            async move {
                calls.lock().await.push(format!("swarm-delete:{agent_id}"));
                StatusCode::OK
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}
