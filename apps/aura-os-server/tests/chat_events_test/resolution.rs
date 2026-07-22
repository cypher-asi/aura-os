//! Bare-agent route resolution under aura-network failures.

use std::sync::Arc;

use aura_os_core::{Agent, AgentId, AgentPermissions};
use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use super::common::*;

async fn start_network_failure(status: StatusCode) -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move || async move {
            (
                status,
                axum::Json(serde_json::json!({ "error": status.to_string() })),
            )
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

fn local_agent(agent_id: AgentId, user_id: &str) -> Agent {
    let now = chrono::Utc::now();
    Agent {
        agent_id,
        user_id: user_id.into(),
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

async fn app_with_network_status(
    status: StatusCode,
) -> (Router, aura_os_server::AppState, tempfile::TempDir) {
    let network_url = start_network_failure(status).await;
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&network_url));
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (app, state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        None,
        None,
        None,
        true,
    );
    (app, state, store_dir)
}

#[tokio::test]
async fn network_outage_uses_only_caller_owned_shadow() {
    let (app, state, _store_dir) = app_with_network_status(StatusCode::SERVICE_UNAVAILABLE).await;

    let owned_agent_id = AgentId::new();
    state
        .agent_service
        .save_agent_shadow(&local_agent(owned_agent_id, "u1"))
        .unwrap();
    let owned_response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/agents/{owned_agent_id}/events/stream"),
            Some(serde_json::json!({ "content": "ping" })),
        ))
        .await
        .unwrap();
    assert_eq!(owned_response.status(), StatusCode::BAD_REQUEST);
    let owned_body = response_json(owned_response).await;
    assert!(owned_body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("desktop app"));

    let foreign_agent_id = AgentId::new();
    state
        .agent_service
        .save_agent_shadow(&local_agent(foreign_agent_id, "another-user"))
        .unwrap();
    let foreign_response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/agents/{foreign_agent_id}/events/stream"),
            Some(serde_json::json!({ "content": "ping" })),
        ))
        .await
        .unwrap();
    assert_eq!(foreign_response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let foreign_body = response_json(foreign_response).await;
    assert_eq!(foreign_body["code"], "agent_directory_unavailable");
    assert!(!foreign_body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("error sending request"));
}

#[tokio::test]
async fn network_not_found_does_not_adopt_another_users_shadow() {
    let (app, state, _store_dir) = app_with_network_status(StatusCode::NOT_FOUND).await;
    let foreign_agent_id = AgentId::new();
    state
        .agent_service
        .save_agent_shadow(&local_agent(foreign_agent_id, "another-user"))
        .unwrap();

    let response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/agents/{foreign_agent_id}/events/stream"),
            Some(serde_json::json!({ "content": "ping" })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
