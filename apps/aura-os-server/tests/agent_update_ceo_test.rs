//! Regression tests for the "editing the CEO SuperAgent strips the
//! preset" bug.
//!
//! The AgentEditorModal submits `PUT /api/agents/:id` without a
//! `permissions` field (capability editing is not wired into the
//! form today). Historically, when aura-network's PUT response came
//! back without `permissions`, `NetworkAgent::permissions`
//! deserialized to the empty bundle via `#[serde(default)]` and that
//! empty projection flowed back to the UI — which then failed every
//! `isSuperAgent` check (primary permissions-based check and the
//! CEO/CEO name/role fallback both fail once the user renames to
//! "Orion"). The local shadow was clobbered on the same code path,
//! so the regression survived app restarts.
//!
//! The fix layers three defences:
//! 1. `update_agent` now calls `reconcile_permissions_with_shadow`
//!    before `save_agent_shadow` — the same rescue the GET/list
//!    paths already use.
//! 2. `save_agent_shadow` / `save_agent_shadows_if_changed` refuse
//!    to overwrite a non-empty stored bundle with an empty one.
//! 3. The bootstrap stamps the CEO `agent_id` so an already-
//!    corrupted shadow can still be healed by identity when the
//!    user has renamed the CEO.
//!
//! These tests lock in each layer end-to-end against the real
//! `PUT /api/agents/:id` handler with a mock aura-network that
//! omits `permissions` from its response.

mod common;

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::{Json, Router};
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_agents::AgentService;
use aura_os_core::{Agent, AgentId, AgentPermissions};
use aura_os_network::NetworkClient;
use aura_os_store::SettingsStore;

use common::*;

const CEO_UUID: &str = "11111111-2222-3333-4444-555555555555";
const NOW: &str = "2024-01-01T00:00:00Z";

/// Build a `NetworkAgent` JSON record with the given name and role
/// but NO `permissions` field — simulating the aura-network response
/// shape that triggers the original bug.
fn network_ceo_json_without_permissions(name: &str, role: &str) -> Value {
    serde_json::json!({
        "id": CEO_UUID,
        "name": name,
        "role": role,
        "userId": "u1",
        "machineType": "local",
        "createdAt": NOW,
        "updatedAt": NOW,
    })
}

/// Spin up a mock aura-network whose `GET /api/agents/:id` and
/// `PUT /api/agents/:id` both return an agent with `permissions`
/// omitted from the JSON. The PUT handler echoes back whatever `name`
/// the caller sent so we can assert that the rename flowed through.
async fn start_mock_network_permissions_stripped(initial_name: String) -> String {
    let name_state = Arc::new(tokio::sync::Mutex::new(initial_name));

    let name_for_get = name_state.clone();
    let get_handler = get(move |Path(_id): Path<String>| {
        let state = name_for_get.clone();
        async move {
            let name = state.lock().await.clone();
            Json(network_ceo_json_without_permissions(&name, "CEO"))
        }
    });

    let name_for_put = name_state.clone();
    let put_handler = put(
        move |Path(_id): Path<String>, Json(body): Json<Value>| {
            let state = name_for_put.clone();
            async move {
                if let Some(new_name) = body.get("name").and_then(|v| v.as_str()) {
                    *state.lock().await = new_name.to_string();
                }
                let role = body
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("CEO")
                    .to_string();
                let name = state.lock().await.clone();
                Json(network_ceo_json_without_permissions(&name, &role))
            }
        },
    );

    let app = Router::new().route("/api/agents/:agent_id", get_handler.merge(put_handler));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Seed the local shadow with a CEO agent holding the canonical
/// `ceo_preset` bundle. Mirrors what `setup_ceo_agent` would have
/// written on first launch.
fn seed_ceo_shadow(agent_service: &AgentService, name: &str) -> Agent {
    let agent_id: AgentId = CEO_UUID.parse().unwrap();
    let now = chrono::Utc::now();
    let agent = Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: name.into(),
        role: "CEO".into(),
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
        network_agent_id: Some(agent_id),
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::ceo_preset(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    };
    agent_service.save_agent_shadow(&agent).unwrap();
    agent
}

/// Build a minimal PUT body that renames the CEO and sets a custom
/// system prompt — the exact shape the AgentEditorModal sends.
/// Crucially, `permissions` is absent.
fn rename_ceo_body(new_name: &str, system_prompt: &str) -> Value {
    serde_json::json!({
        "name": new_name,
        "role": "CEO",
        "personality": "",
        "system_prompt": system_prompt,
        "skills": [],
    })
}

/// Fix 1: shadow-based rescue on the PUT path.
///
/// The shadow holds `ceo_preset`; the mock network omits permissions
/// on both GET and PUT. Renaming to "Orion" + custom system prompt
/// must still return an agent with the full CEO preset, and the
/// shadow must NOT be corrupted after the save.
#[tokio::test]
async fn put_preserves_ceo_preset_when_network_drops_permissions() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_permissions_stripped("CEO".to_string()).await;

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        None,
        None,
        None,
    );

    seed_ceo_shadow(&state.agent_service, "CEO");

    let resp = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &format!("/api/agents/{CEO_UUID}"),
            Some(rename_ceo_body("Orion", "You are Orion.")),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["name"], "Orion", "rename must flow through");

    let permissions = &body["permissions"];
    assert!(
        permissions.is_object(),
        "response must include a permissions bundle, got: {body}"
    );
    let parsed: AgentPermissions = serde_json::from_value(permissions.clone()).unwrap();
    assert!(
        parsed.is_ceo_preset(),
        "renaming the CEO must not strip the preset; got {:?}",
        parsed.capabilities
    );

    // Shadow must still carry the preset — the save_agent_shadow guard
    // plus the PUT-side reconcile should both have prevented the
    // empty-bundle clobber that caused the original bug.
    let agent_id: AgentId = CEO_UUID.parse().unwrap();
    let shadow = state.agent_service.get_agent_local(&agent_id).unwrap();
    assert!(
        shadow.permissions.is_ceo_preset(),
        "shadow row must retain the CEO preset after PUT"
    );
}

/// Fix 3: agent_id-based last-resort rescue.
///
/// Simulates a user whose shadow was already corrupted by the
/// pre-fix PUT flow (both the network response AND the shadow have
/// empty permissions). The bootstrap-stamped CEO agent_id must still
/// restore the preset after a rename, so users can heal without
/// re-running setup.
#[tokio::test]
async fn put_restores_ceo_preset_by_agent_id_when_shadow_also_empty() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_permissions_stripped("Orion".to_string()).await;

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        None,
        None,
        None,
    );

    // Seed the shadow with an EMPTY permissions bundle (already
    // renamed + corrupted state). Then stamp the agent_id as the
    // bootstrapped CEO so the identity-by-id repair can kick in.
    let agent_id: AgentId = CEO_UUID.parse().unwrap();
    let now = chrono::Utc::now();
    let broken_shadow = Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Orion".into(),
        role: "CEO".into(),
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
        network_agent_id: Some(agent_id),
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
    };
    state
        .agent_service
        .save_agent_shadow(&broken_shadow)
        .unwrap();
    state.agent_service.remember_ceo_agent_id(&agent_id);

    let resp = app
        .oneshot(json_request(
            "PUT",
            &format!("/api/agents/{CEO_UUID}"),
            Some(rename_ceo_body("Orion", "You are still Orion.")),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    let permissions: AgentPermissions =
        serde_json::from_value(body["permissions"].clone()).unwrap();
    assert!(
        permissions.is_ceo_preset(),
        "agent_id-based rescue must restore the CEO preset; got {:?}",
        permissions.capabilities
    );
}

/// GET regression: after a PUT that renames the CEO, a subsequent
/// GET must also return the preset. Exercises the GET-path
/// reconcile on top of the freshly-saved shadow.
#[tokio::test]
async fn get_after_rename_still_returns_ceo_preset() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_permissions_stripped("CEO".to_string()).await;

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&network_url))),
        None,
        None,
        None,
    );

    seed_ceo_shadow(&state.agent_service, "CEO");

    let put_resp = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &format!("/api/agents/{CEO_UUID}"),
            Some(rename_ceo_body("Orion", "You are Orion.")),
        ))
        .await
        .unwrap();
    assert_eq!(put_resp.status(), StatusCode::OK);

    let get_resp = app
        .oneshot(json_request(
            "GET",
            &format!("/api/agents/{CEO_UUID}"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);

    let body = response_json(get_resp).await;
    assert_eq!(body["name"], "Orion");
    let permissions: AgentPermissions =
        serde_json::from_value(body["permissions"].clone()).unwrap();
    assert!(
        permissions.is_ceo_preset(),
        "GET after rename must still report the preset; got {:?}",
        permissions.capabilities
    );
}
