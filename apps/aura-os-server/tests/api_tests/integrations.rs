use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use tower::ServiceExt;

use aura_os_billing::BillingClient;
use aura_os_core::*;
use aura_os_integrations::PLATFORM_BRAVE_KEY_ENV;

use crate::common::*;

use super::integration_actions::*;
use super::integration_setup::{create_test_integrations, ProviderEnvGuard};

const NETWORK_IDENTITY_USER_ID: &str = "00000000-0000-0000-0000-000000000042";

fn platform_key_env_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    &LOCK
}

struct PlatformKeyEnvGuard {
    prev: Option<String>,
}

impl PlatformKeyEnvGuard {
    fn set(value: &str) -> Self {
        let prev = std::env::var(PLATFORM_BRAVE_KEY_ENV).ok();
        std::env::set_var(PLATFORM_BRAVE_KEY_ENV, value);
        Self { prev }
    }

    fn unset() -> Self {
        let prev = std::env::var(PLATFORM_BRAVE_KEY_ENV).ok();
        std::env::remove_var(PLATFORM_BRAVE_KEY_ENV);
        Self { prev }
    }
}

impl Drop for PlatformKeyEnvGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(PLATFORM_BRAVE_KEY_ENV, value),
            None => std::env::remove_var(PLATFORM_BRAVE_KEY_ENV),
        }
    }
}

type TestApp = (Router, aura_os_server::AppState, tempfile::TempDir);

async fn start_test_server(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

fn build_isolated_test_app(
    network_url: &str,
    billing_client: Option<Arc<BillingClient>>,
) -> TestApp {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(aura_os_network::NetworkClient::with_base_url(
            network_url,
        ))),
        None,
        None,
        billing_client,
    );
    (app, state, store_dir)
}

fn owner_members_app() -> Router {
    Router::new().route(
        "/api/orgs/:org_id/members",
        get(|Path(org_id): Path<String>| async move {
            Json(vec![serde_json::json!({
                "userId": "u1",
                "orgId": org_id,
                "role": "owner",
            })])
        }),
    )
}

async fn start_mock_subscription_billing(plan: &str) -> Arc<BillingClient> {
    async fn subscription_status(State(plan): State<String>) -> Json<serde_json::Value> {
        Json(serde_json::json!({
            "plan": plan,
            "is_subscribed": plan != "mortal",
            "monthly_credits": 0,
            "current_period_end": null,
        }))
    }

    let app = Router::new()
        .route("/v1/subscriptions/me", get(subscription_status))
        .with_state(plan.to_string());
    Arc::new(BillingClient::with_base_url(start_test_server(app).await))
}

async fn build_test_app_with_org_membership() -> TestApp {
    build_test_app_with_org_membership_and_billing_plan("mortal").await
}

async fn build_test_app_with_org_membership_and_billing_plan(plan: &str) -> TestApp {
    let billing_client = start_mock_subscription_billing(plan).await;
    build_test_app_with_org_membership_and_billing_client(billing_client).await
}

async fn build_test_app_with_org_membership_and_billing_client(
    billing_client: Arc<BillingClient>,
) -> TestApp {
    let network_url = start_test_server(owner_members_app()).await;
    build_isolated_test_app(&network_url, Some(billing_client))
}

async fn build_test_app_with_network_identity_membership() -> TestApp {
    let network_app = Router::new()
        .route(
            "/api/orgs/:org_id/members",
            get(|Path(org_id): Path<String>| async move {
                Json(vec![serde_json::json!({
                    "userId": NETWORK_IDENTITY_USER_ID,
                    "orgId": org_id,
                    "role": "owner",
                })])
            }),
        )
        .route(
            "/api/users/me",
            get(|| async {
                Json(serde_json::json!({
                    "id": NETWORK_IDENTITY_USER_ID,
                    "displayName": "Test User",
                    "profileId": null,
                }))
            }),
        );
    let network_url = start_test_server(network_app).await;
    let billing_client = start_mock_subscription_billing("mortal").await;
    build_isolated_test_app(&network_url, Some(billing_client))
}

async fn build_test_app_with_empty_canonical_integrations() -> TestApp {
    let network_url = start_test_server(owner_members_app()).await;

    let integrations_app = Router::new()
        .route(
            "/api/orgs/:org_id/integrations",
            get(|| async { Json::<Vec<serde_json::Value>>(vec![]) }),
        )
        .route(
            "/internal/orgs/:org_id/integrations",
            get(|| async { Json::<Vec<serde_json::Value>>(vec![]) }),
        );
    let integrations_url = start_test_server(integrations_app).await;
    let integrations_client = Arc::new(aura_os_integrations::IntegrationsClient::with_base_url(
        &integrations_url,
        "test-internal-token",
    ));
    let billing_client = start_mock_subscription_billing("mortal").await;
    let (_app, mut state, store_dir) = build_isolated_test_app(&network_url, Some(billing_client));
    state.integrations_client = Some(integrations_client);
    let app = aura_os_server::create_router_with_interface(state.clone(), None);
    (app, state, store_dir)
}

async fn build_test_app_without_org_membership() -> TestApp {
    let members_app = Router::new().route(
        "/api/orgs/:org_id/members",
        get(|| async { Json::<Vec<serde_json::Value>>(vec![]) }),
    );
    let network_url = start_test_server(members_app).await;
    build_isolated_test_app(&network_url, None)
}

async fn build_test_app_with_members_upstream_error() -> TestApp {
    let members_app = Router::new().route(
        "/api/orgs/:org_id/members",
        get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
    );
    let network_url = start_test_server(members_app).await;
    build_isolated_test_app(&network_url, None)
}

async fn build_test_app_with_members_transport_failure() -> TestApp {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let network_url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    build_isolated_test_app(&network_url, None)
}

#[tokio::test]
async fn org_tool_actions_use_saved_integrations() {
    let _lock = platform_key_env_lock().lock().await;
    let _platform_off = PlatformKeyEnvGuard::unset();
    let _env = ProviderEnvGuard::set_up().await;

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    create_test_integrations(&app, &org_id).await;

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed["integrations"].as_array().unwrap().len(), 12);

    assert_github_actions(&app, &org_id).await;
    assert_linear_actions(&app, &org_id).await;
    assert_slack_actions(&app, &org_id).await;
    assert_notion_actions(&app, &org_id).await;
    assert_brave_actions(&app, &org_id).await;
    assert_freepik_actions(&app, &org_id).await;
    assert_apify_actions(&app, &org_id).await;
    assert_metricool_actions(&app, &org_id).await;
    assert_mailchimp_actions(&app, &org_id).await;
    assert_resend_actions(&app, &org_id).await;
    assert_google_actions(&app, &org_id).await;
}

#[tokio::test]
async fn platform_brave_fallback_is_off_without_platform_key() {
    let _lock = platform_key_env_lock().lock().await;
    let _env = PlatformKeyEnvGuard::unset();

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({
            "query": "aura",
            "integration_id": "platform-brave-search"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

#[tokio::test]
async fn platform_key_set_does_not_leak_synthetic_into_rest_list() {
    let _lock = platform_key_env_lock().lock().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    create_test_integrations(&app, &org_id).await;

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;

    let integrations = listed["integrations"].as_array().unwrap();
    assert_eq!(
        integrations.len(),
        12,
        "platform key must not add a synthetic entry to the REST list"
    );
    assert!(
        integrations
            .iter()
            .all(|i| i["integration_id"].as_str() != Some("platform-brave-search")),
        "the platform capability id must not appear in the REST list"
    );
}

#[tokio::test]
async fn platform_key_brave_tool_action_resolves_platform_key_end_to_end() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let brave_web = response_json(resp).await;
    assert_eq!(brave_web["results"][0]["title"], "Platform Brave result");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_news"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let brave_news = response_json(resp).await;
    assert_eq!(brave_news["results"][0]["title"], "Platform Brave news");
}

#[tokio::test]
async fn platform_web_search_resolves_network_identity_for_cloud_callback() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, state, _db) = build_test_app_with_network_identity_membership().await;
    let org_id = OrgId::new();

    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
            Some(serde_json::json!({ "query": "aura" })),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        state
            .validation_cache
            .get("test-token")
            .and_then(|cached| cached.session.network_user_id)
            .map(|id| id.to_string())
            .as_deref(),
        Some(NETWORK_IDENTITY_USER_ID)
    );
}

#[tokio::test]
async fn canonical_empty_uses_platform_quota_despite_stale_local_byok() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, state, _db) = build_test_app_with_empty_canonical_integrations().await;
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            Some("stale-local-brave"),
            "Stale Brave Shadow".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            aura_os_orgs::IntegrationSecretUpdate::Set("stale-key".to_string()),
        )
        .unwrap();

    let max = aura_os_server::tool_action_rate_limit::MORTAL_CALLS_PER_MINUTE;
    for _ in 0..max {
        let response = app
            .clone()
            .oneshot(json_request(
                "POST",
                &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
                Some(serde_json::json!({ "query": "aura" })),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
            Some(serde_json::json!({ "query": "aura" })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn disabled_workspace_integrations_are_kept_but_not_exposed_as_active_capabilities() {
    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "GitHub Disabled",
            "provider": "github",
            "kind": "workspace_integration",
            "api_key": "ghp_disabled",
            "enabled": false
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = response_json(resp).await;
    assert_eq!(created["enabled"], false);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed["integrations"][0]["enabled"], false);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_list_repos"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

#[tokio::test]
async fn brave_search_byok_create_and_rekey_are_allowed() {
    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Web Search BYOK",
            "provider": "brave_search",
            "kind": "workspace_integration",
            "api_key": "brave_test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["provider"], "brave_search");
    assert_eq!(body["name"], "Web Search BYOK");
    let integration_id = body["integration_id"].as_str().unwrap();

    let req = json_request(
        "PUT",
        &format!("/api/orgs/{org_id}/integrations/{integration_id}"),
        Some(serde_json::json!({
            "api_key": "new-brave-key"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["provider"], "brave_search");
}

#[tokio::test]
async fn brave_search_byok_can_be_disabled() {
    use aura_os_orgs::IntegrationSecretUpdate;

    let (app, state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let legacy = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Web Search BYOK".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("old-brave-key".to_string()),
        )
        .expect("seed legacy brave integration");

    let req = json_request(
        "PUT",
        &format!("/api/orgs/{org_id}/integrations/{}", legacy.integration_id),
        Some(serde_json::json!({
            "enabled": false
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["enabled"], false);
}

#[tokio::test]
async fn non_member_cannot_invoke_tool_actions() {
    let (app, _state, _db) = build_test_app_without_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unauthenticated_tool_action_callback_is_rejected() {
    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/orgs/{org_id}/tool-actions/brave_search_web"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({ "query": "aura" })).unwrap(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn authz_gate_fails_closed_on_upstream_500() {
    let (app, _state, _db) = build_test_app_with_members_upstream_error().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn authz_gate_fails_closed_on_transport_failure() {
    let (app, _state, _db) = build_test_app_with_members_transport_failure().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn web_search_quota_is_scoped_to_user_and_search_tools() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let max = aura_os_server::tool_action_rate_limit::MORTAL_CALLS_PER_MINUTE;

    for _ in 0..=max {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
            Some(serde_json::json!({})),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    for _ in 0..max {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
            Some(serde_json::json!({ "query": "aura" })),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "tool_action_rate_limited");
    assert_eq!(body["data"]["max_calls"], max);
    assert_eq!(body["data"]["window_seconds"], 60);
    assert!(body["data"]["retry_after_seconds"].as_u64().unwrap() > 0);
    assert_eq!(
        body["data"]["upgrade_hint"],
        "Upgrade your plan for higher Aura Web Search limits."
    );
    assert_eq!(
        body["data"]["byok_hint"],
        "Connect your own Brave Search API key to use Web Search without Aura quota."
    );

    let other_org_id = OrgId::new();
    let req = json_request(
        "POST",
        &format!("/api/orgs/{other_org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn paid_billing_plan_gets_higher_web_search_limit() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, _state, _db) = build_test_app_with_org_membership_and_billing_plan("pro").await;
    let org_id = OrgId::new();

    let default_max = aura_os_server::tool_action_rate_limit::MORTAL_CALLS_PER_MINUTE;
    for _ in 0..=default_max {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
            Some(serde_json::json!({ "query": "aura" })),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "z-billing Pro entitlement should allow calls beyond the Mortal limit"
        );
    }
}

#[tokio::test]
async fn unavailable_billing_falls_back_to_mortal_web_search_limit() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let billing_url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let billing_client =
        std::sync::Arc::new(aura_os_billing::BillingClient::with_base_url(billing_url));
    let (app, _state, _db) =
        build_test_app_with_org_membership_and_billing_client(billing_client).await;
    let org_id = OrgId::new();
    let max = aura_os_server::tool_action_rate_limit::MORTAL_CALLS_PER_MINUTE;

    for _ in 0..max {
        let response = app
            .clone()
            .oneshot(json_request(
                "POST",
                &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
                Some(serde_json::json!({ "query": "aura" })),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
            Some(serde_json::json!({ "query": "aura" })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn org_billing_plan_cannot_be_changed_through_legacy_route() {
    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();
    let response = app
        .oneshot(json_request(
            "PUT",
            &format!("/api/orgs/{org_id}/billing"),
            Some(serde_json::json!({ "plan": "sage" })),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn brave_search_byok_bypasses_aura_web_search_quota() {
    let _lock = platform_key_env_lock().lock().await;
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _platform_off = PlatformKeyEnvGuard::unset();

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Web Search BYOK",
            "provider": "brave_search",
            "kind": "workspace_integration",
            "api_key": "brave_test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let default_max = aura_os_server::tool_action_rate_limit::MORTAL_CALLS_PER_MINUTE;
    for _ in 0..=default_max {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
            Some(serde_json::json!({ "query": "aura" })),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "org-owned Brave key should not consume Aura Web Search quota"
        );
    }
}
