//! Chat-stream error paths and project-context-aware system prompt.

use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_core::*;

use super::common::*;

/// 7a. chat_persist_unavailable: POST /api/agents/:id/events/stream with no
///     project-agent binding returns HTTP 424 with the structured error shape
///     that `send_to_agent` parses.
#[tokio::test]
async fn agent_chat_stream_returns_424_when_no_project_binding() {
    // Fake aura-network that 404s every agent GET. The chat handler maps a
    // 404 to `AgentError::NotFound` and then falls back to the local agent
    // shadow, so saving the shadow below is enough to resolve the agent.
    let net_app = Router::new().route(
        "/api/agents/:agent_id",
        get(|| async {
            (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({ "error": "not found" })),
            )
        }),
    );
    let net_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let net_addr = net_listener.local_addr().unwrap();
    let net_url = format!("http://{net_addr}");
    tokio::spawn(async move { axum::serve(net_listener, net_app).await.ok() });

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(aura_os_storage::StorageClient::with_base_url(&storage_url));
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&net_url));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        Some(storage),
        None,
        None,
    );

    let agent_id = AgentId::new();
    let agent = Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Lonely".into(),
        role: "dev".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        // `local` auth_source bypasses the `require_credits_for_auth_source`
        // billing guard so the test doesn't need a billing mock.
        auth_source: "local".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
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
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    state.agent_service.save_agent_shadow(&agent).unwrap();

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/events/stream"),
        Some(serde_json::json!({ "content": "ping" })),
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(
        resp.status(),
        axum::http::StatusCode::FAILED_DEPENDENCY,
        "chat_persist_unavailable must return HTTP 424"
    );

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["code"], "chat_persist_unavailable");
    let data = body
        .get("data")
        .expect("structured error body must include `data`");
    assert_eq!(data["code"], "chat_persist_unavailable");
    assert!(
        data["reason"].is_string(),
        "reason must be populated so send_to_agent can surface it"
    );
    assert!(data["upstream_status"].is_null());
    assert!(data["session_id"].is_null());
    assert!(data["project_id"].is_null());
    assert!(data["project_agent_id"].is_null());
}

#[tokio::test]
async fn system_prompt_includes_project_context() {
    let prompt = aura_os_server::handlers_test_support::build_project_system_prompt_for_test(
        "test-project-id",
        "My Project",
        "A test project for integration testing",
        "You are a helpful assistant.",
    );

    assert!(
        prompt.contains("<project_context>"),
        "should contain project_context tag"
    );
    assert!(
        prompt.contains("test-project-id"),
        "should contain project_id"
    );
    assert!(prompt.contains("My Project"), "should contain project name");
    assert!(
        prompt.contains("A test project for integration testing"),
        "should contain description"
    );
    assert!(
        prompt.contains("You are a helpful assistant."),
        "should contain agent prompt"
    );
    assert!(
        prompt.contains("project_id"),
        "should instruct model about project_id"
    );
}
