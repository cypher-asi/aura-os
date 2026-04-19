//! Regression tests for the "refuse to ship loopback URL to a remote
//! harness" session-assembly gate.
//!
//! Drives the [`/api/agents/:agent_id/installed-tools`] diagnostic —
//! the same path the live chat handler uses to stamp cross-agent tool
//! endpoints, minus the streaming plumbing — and asserts that:
//!
//! 1. When the agent's `machine_type` is `remote` and
//!    `AURA_SERVER_BASE_URL` is unset, the server refuses to stamp
//!    `http://127.0.0.1:<port>` onto the manifest and surfaces a
//!    named 500 error that includes the env var name. This used to
//!    silently succeed and then fail later with `os error 10061` on
//!    every cross-agent tool invocation.
//! 2. When `AURA_SERVER_BASE_URL` is set to a public URL, the
//!    diagnostic succeeds and none of the stamped endpoints contain a
//!    loopback host.

mod common;

use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::get;
use axum::Json;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_network::NetworkClient;
use aura_os_store::SettingsStore;

use common::*;

const AGENT_UUID: &str = "00000000-aaaa-bbbb-cccc-dddddddddddd";
const NOW: &str = "2024-01-01T00:00:00Z";

fn network_agent_json(machine_type: &str) -> Value {
    // Naming the agent "CEO" with role "CEO" triggers
    // `AgentPermissions::normalized_for_identity` to promote an empty
    // permissions bundle to the full CEO preset at read time, which
    // in turn makes `build_cross_agent_tools` emit the full
    // cross-agent manifest that exercises the stamping path.
    serde_json::json!({
        "id": AGENT_UUID,
        "name": "CEO",
        "userId": "u1",
        "role": "CEO",
        "personality": "helpful",
        "systemPrompt": "",
        "skills": [],
        "machineType": machine_type,
        "createdAt": NOW,
        "updatedAt": NOW,
    })
}

async fn start_mock_network_serving_agent(agent_json: Value) -> String {
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

/// Cross-test env-var mutex. These tests mutate process-wide env vars
/// (`AURA_SERVER_BASE_URL` specifically) and must not race — running
/// them in the same process in parallel would leak a half-set value
/// into the other test's handler.
fn env_lock() -> &'static StdMutex<()> {
    static LOCK: StdMutex<()> = StdMutex::new(());
    &LOCK
}

struct EnvGuard {
    key: &'static str,
    prev: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let prev = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, prev }
    }

    fn unset(key: &'static str) -> Self {
        let prev = std::env::var(key).ok();
        std::env::remove_var(key);
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

fn build_app_with_network(network_url: &str) -> axum::Router {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(network_url))),
        None,
        None,
        None,
    );
    // Leak the tempdir so the SettingsStore backing files outlive the
    // test router (this integration test doesn't need to clean up).
    std::mem::forget(store_dir);
    app
}

// Env-var mutations are process-wide; we deliberately hold the sync
// `Mutex` across `.await` so no other test can flip
// `AURA_SERVER_BASE_URL` while we're driving the server. Clippy's
// default warning assumes any Mutex crossing an await is a deadlock
// risk, which doesn't apply to this test-only env guard.
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn installed_tools_diagnostic_refuses_loopback_for_remote_agent() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
    let _host = EnvGuard::unset("AURA_SERVER_HOST");
    let _port = EnvGuard::unset("AURA_SERVER_PORT");

    let network_url = start_mock_network_serving_agent(network_agent_json("remote")).await;
    let app = build_app_with_network(&network_url);

    let req = json_request(
        "GET",
        &format!("/api/agents/{AGENT_UUID}/installed-tools"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "remote-harness + no AURA_SERVER_BASE_URL must surface as a named error"
    );
    let body = response_json(resp).await;
    let error_message = body["error"].as_str().unwrap_or_default();
    assert!(
        error_message.contains("AURA_SERVER_BASE_URL"),
        "error message must name the offending env var, got: {error_message}"
    );
    assert!(
        error_message.contains("127.0.0.1"),
        "error message must name the offending fallback URL, got: {error_message}"
    );
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn installed_tools_diagnostic_stamps_public_base_url_for_remote_agent() {
    let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
    let _base = EnvGuard::set("AURA_SERVER_BASE_URL", "https://aura.example.com");
    let _host = EnvGuard::unset("AURA_SERVER_HOST");
    let _port = EnvGuard::unset("AURA_SERVER_PORT");

    let network_url = start_mock_network_serving_agent(network_agent_json("remote")).await;
    let app = build_app_with_network(&network_url);

    let req = json_request(
        "GET",
        &format!("/api/agents/{AGENT_UUID}/installed-tools"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "explicit AURA_SERVER_BASE_URL must let the diagnostic succeed"
    );
    let body = response_json(resp).await;
    let tools = body["tools"]
        .as_array()
        .expect("tools array must be present in diagnostic payload");
    assert!(
        !tools.is_empty(),
        "CEO preset must produce cross-agent tools"
    );
    for tool in tools {
        let endpoint = tool["endpoint"].as_str().unwrap_or_default();
        assert!(
            !endpoint.contains("127.0.0.1"),
            "no stamped endpoint may contain loopback once AURA_SERVER_BASE_URL is set, got: {endpoint}"
        );
        assert!(
            !endpoint.contains("localhost"),
            "no stamped endpoint may contain localhost once AURA_SERVER_BASE_URL is set, got: {endpoint}"
        );
    }
}
