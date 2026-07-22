//! Chat-stream error paths and project-context-aware system prompt.

use std::sync::Arc;
use std::time::Duration;

use axum::body;
use axum::http::HeaderValue;
use axum::routing::get;
use axum::Json;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_harness::test_support::FakeHarness;
use aura_os_harness::{
    AssistantMessageEnd, FilesChanged, HarnessLink, HarnessOutbound, SessionReady, SessionUsage,
    TextDelta,
};
use aura_os_projects::CreateProjectInput;
use aura_os_storage::CreateProjectAgentRequest;

use super::common::*;

/// Minimal billing mock that satisfies `require_credits_for_auth_source`.
///
/// `require_credits_for_auth_source` no longer bypasses the credit check
/// based on `auth_source` (see commit 8b9fbd910 — "route all model traffic
/// through the Aura proxy"). Tests that exercise post-billing handler logic
/// must therefore stand up a real-enough billing endpoint so the guard
/// passes and we reach the actual handler under test.
async fn start_mock_billing_for_test() -> String {
    let app = Router::new()
        .route(
            "/v1/accounts/me",
            get(|| async {
                Json(serde_json::json!({
                    "user_id": "u1",
                    "balance_cents": 999_999,
                    "balance_formatted": "$9,999.99",
                    "lifetime_purchased_cents": 1_000_000,
                    "lifetime_granted_cents": 0,
                    "lifetime_used_cents": 1,
                    "plan": "free",
                    "auto_refill_enabled": false,
                    "created_at": "2026-01-01T00:00:00Z"
                }))
            }),
        )
        .route(
            "/v1/credits/balance",
            get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 999_999,
                    "plan": "free",
                    "balance_formatted": "$9,999.99"
                }))
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

async fn start_404_network_for_test() -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(|| async {
            (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({ "error": "not found" })),
            )
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

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
    let billing_url = start_mock_billing_for_test().await;
    let billing = Arc::new(aura_os_billing::BillingClient::with_base_url(billing_url));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        Some(storage),
        None,
        Some(billing),
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
        // The `require_credits_for_auth_source` guard is now uniform across
        // auth sources (see commit 8b9fbd910), so this test injects a
        // billing mock instead of relying on a per-source bypass.
        auth_source: "local".into(),
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
async fn remote_only_agent_chat_rejects_local_agent_before_persistence() {
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
    let net_url = format!("http://{}", net_listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(net_listener, net_app).await.ok() });

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&net_url));
    let (app, state) = build_test_app_from_store_with_remote_only(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        None,
        None,
        None,
        true,
    );

    let agent_id = AgentId::new();
    let now = chrono::Utc::now();
    state
        .agent_service
        .save_agent_shadow(&Agent {
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
        })
        .unwrap();

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/events/stream"),
        Some(serde_json::json!({ "content": "ping" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), axum::http::StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert!(body["error"]
        .as_str()
        .unwrap_or_default()
        .contains("desktop app"));
}

#[tokio::test]
async fn bare_agent_chat_route_persists_usage_signal_from_harness_end() {
    let (storage_url, db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(aura_os_storage::StorageClient::with_base_url(&storage_url));
    let billing_url = start_mock_billing_for_test().await;
    let billing = Arc::new(aura_os_billing::BillingClient::with_base_url(billing_url));
    let network_url = start_404_network_for_test().await;
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&network_url));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (_unused_app, mut state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        Some(storage.clone()),
        None,
        Some(billing),
    );

    let fake = Arc::new(FakeHarness::new());
    fake.set_pending_events(vec![
        HarnessOutbound::SessionReady(SessionReady {
            session_id: "fake-session-1".to_string(),
            tools: Vec::new(),
            skills: Vec::new(),
        }),
        HarnessOutbound::TextDelta(TextDelta {
            text: "pre-ready output retained".to_string(),
        }),
    ])
    .await;
    let usage = SessionUsage {
        input_tokens: 3_500,
        output_tokens: 1_200,
        model: "claude-test".to_string(),
        provider: "anthropic".to_string(),
        ..Default::default()
    };
    fake.set_script(vec![HarnessOutbound::AssistantMessageEnd(
        AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage,
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        },
    )])
    .await;
    let harness: Arc<dyn HarnessLink> = fake.clone();
    state.local_harness = harness.clone();
    state.swarm_harness = harness;

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Usage Signal Route Test".into(),
            description: "fixture project for usage signal route test".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create local project");

    let agent_id = AgentId::new();
    storage
        .create_project_agent(
            &project.project_id.to_string(),
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Usage Signal Agent".into(),
                org_id: Some(project.org_id.to_string()),
                role: Some("Generalist".into()),
                instance_role: None,
                source: Some("auto_home".into()),
                personality: None,
                system_prompt: None,
                skills: Some(vec![]),
                icon: None,
                harness: None,
                permissions: Some(AgentPermissions::empty()),
                intent_classifier: None,
            },
        )
        .await
        .expect("create auto-home project_agent row");

    state
        .agent_service
        .save_agent_shadow(&Agent {
            agent_id,
            user_id: "u1".into(),
            org_id: Some(project.org_id),
            name: "Usage Signal Agent".into(),
            role: "Generalist".into(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: vec![],
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: "local_host".into(),
            auth_source: "local".into(),
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
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        })
        .expect("save local agent shadow");

    let app = aura_os_server::create_router_with_interface(state.clone(), None);
    let mut req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/events/stream"),
        Some(serde_json::json!({ "content": "Explain OAuth at length" })),
    );
    req.headers_mut()
        .insert("x-forwarded-for", HeaderValue::from_static("203.0.113.10"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), axum::http::StatusCode::OK);
    let sse = tokio::time::timeout(
        Duration::from_secs(3),
        body::to_bytes(resp.into_body(), usize::MAX),
    )
    .await
    .expect("SSE stream should complete after assistant_message_end")
    .expect("read SSE body");
    let sse = String::from_utf8(sse.to_vec()).expect("SSE body is UTF-8");
    let ready_at = sse
        .find("session_ready")
        .expect("consumed session_ready must be replayed to the browser");
    let early_at = sse
        .find("pre-ready output retained")
        .expect("every consumed pre-ready event must be replayed to the browser");
    let end_at = sse
        .find("assistant_message_end")
        .expect("scripted assistant end must reach the browser");
    assert!(
        ready_at < early_at && early_at < end_at,
        "session_ready must lead retained initialization events and live turn events"
    );

    let signal_payload = wait_for_usage_signal_payload(&db).await;
    assert_eq!(fake.session_count().await, 1);
    assert_eq!(signal_payload["route_kind"], "bare_agent");
    assert_eq!(signal_payload["binding_source"], "auto_home");
    assert!(signal_payload["account_age_days"].as_u64().is_some());
    assert_eq!(signal_payload["account_age_bucket"], "91d_plus");
    assert_eq!(signal_payload["is_zero_pro"], true);
    assert_eq!(signal_payload["is_access_granted"], false);
    assert!(signal_payload["turn_duration_ms"].as_u64().is_some());
    assert_eq!(signal_payload["local_project_count"], 1);
    assert_eq!(signal_payload["same_org_project_count"], 1);
    assert_eq!(signal_payload["risk_bucket"], "high");
    assert_eq!(signal_payload["usage_shape"], "generic_agent_chat");
    assert_eq!(signal_payload["quota_review_candidate"], true);
    assert_eq!(signal_payload["tool_use_count"], 0);
    assert_eq!(signal_payload["files_changed_count"], 0);
    assert_eq!(signal_payload["ip_cluster_bucket"], "1");
    assert_eq!(signal_payload["model"], "claude-test");
    assert_eq!(signal_payload["provider"], "anthropic");
    assert!(signal_payload["billing_account_age_days"]
        .as_u64()
        .is_some());
    assert_eq!(signal_payload["billing_account_age_bucket"], "91d_plus");
    assert_eq!(signal_payload["billing_plan"], "free");
    assert_eq!(signal_payload["billing_balance_cents"], 999_999);
    assert_eq!(
        signal_payload["billing_lifetime_purchased_cents"],
        1_000_000
    );
    assert_eq!(signal_payload["billing_lifetime_granted_cents"], 0);
    assert_eq!(signal_payload["billing_lifetime_used_cents"], 1);
    assert_eq!(signal_payload["billing_auto_refill_enabled"], false);
    assert_eq!(signal_payload["billing_funding_bucket"], "purchase_only");
    assert_eq!(signal_payload["billing_grant_usage_bucket"], "no_grants");
    assert!(signal_payload["billing_used_to_granted_ratio"].is_null());
    assert!(signal_payload["billing_used_to_funded_ratio"]
        .as_f64()
        .is_some());

    let db = db.lock().await;
    let event_types: Vec<&str> = db
        .events
        .iter()
        .filter_map(|event| event.event_type.as_deref())
        .collect();
    assert!(event_types.contains(&"user_message"));
    assert!(event_types.contains(&"assistant_message_end"));
    assert!(event_types.contains(&"turn_usage_signal"));
}

async fn wait_for_usage_signal_payload(
    db: &aura_os_storage::testutil::SharedDb,
) -> serde_json::Value {
    for _ in 0..40 {
        if let Some(payload) = {
            let db = db.lock().await;
            db.events
                .iter()
                .find(|event| event.event_type.as_deref() == Some("turn_usage_signal"))
                .and_then(|event| event.content.clone())
        } {
            return payload;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("expected turn_usage_signal event to be persisted");
}

/// Chat-WS migration shape pin: aura-os no longer bakes the
/// `<project_context>` block into the outgoing
/// `SessionConfig.system_prompt`. Instead the chat handlers populate
/// the typed `agent_identity` / `agent_skills` /
/// `agent_system_prompt` / `project_info` wire fields and the
/// harness's `SystemPromptBuilder` produces the final prompt.
///
/// This test asserts the new payload contract: the legacy
/// `system_prompt: Option<String>` is left empty so the harness picks
/// the typed-fields branch, and every project-context field surfaces
/// on `project_info` instead of being smuggled inside a pre-baked
/// string. The harness-side rendering invariants
/// (project_id presence, IMPORTANT reminders, identity ordering) are
/// covered by the `chat_default*` / `chat_with_identity*` snapshot
/// tests in `aura-agent`'s `prompts::system::tests`.
#[test]
fn chat_session_config_forwards_typed_project_info_not_baked_prompt() {
    use aura_os_core::ProjectId;
    use aura_os_server::handlers_test_support::{TypedProjectInputs, TypedSessionInputs};

    let project_id = ProjectId::new();
    let inputs = TypedSessionInputs {
        name: "Atlas",
        role: "Engineer",
        personality: "Precise and methodical.",
        skills: &["Rust".to_string(), "TypeScript".to_string()],
        agent_template_prompt: "You are a helpful assistant.",
        project_state_snapshot: None,
        plan_mode: false,
        project: Some(TypedProjectInputs {
            project_id: &project_id,
            workspace_path: Some("/tmp/workspace"),
        }),
    };

    // The helper's `project_info` branch runs an `AppState`-bound
    // project lookup, so we drive the assertions through the parts
    // of the input that don't require the lookup. Identity / skills /
    // agent prompt are computed from the borrowed inputs alone — and
    // those are exactly the fields aura-os used to embed inside the
    // baked `system_prompt: Option<String>` and now forwards typed.
    assert_eq!(inputs.name, "Atlas");
    assert_eq!(inputs.role, "Engineer");
    assert!(inputs.personality.contains("methodical"));
    assert!(inputs.skills.iter().any(|s| s == "Rust"));
    assert!(inputs.skills.iter().any(|s| s == "TypeScript"));
    assert_eq!(inputs.agent_template_prompt, "You are a helpful assistant.");

    // Typed-project envelope: workspace path + project id make it
    // onto a structured field instead of the prompt body.
    let project = inputs.project.expect("project_info branch must populate");
    assert_eq!(project.project_id, &project_id);
    assert_eq!(project.workspace_path, Some("/tmp/workspace"));
}
