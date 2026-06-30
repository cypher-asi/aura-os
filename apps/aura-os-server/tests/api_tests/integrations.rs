use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

use super::integration_actions::*;
use super::integration_setup::{create_test_integrations, ProviderEnvGuard};

#[tokio::test]
async fn org_tool_actions_use_saved_integrations() {
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

/// Spec 02 §9 soft-fallback at the HTTP dispatch layer: when the only brave
/// integration available is the reserved synthetic platform id and
/// `BRAVE_SEARCH_PLATFORM_KEY` is unset, the tool-action endpoint fails cleanly
/// (clean 4xx, no panic) — the feature is effectively off. The success path
/// (env set → platform key resolves) is proven by the unit-level precedence
/// test in `org_tools::tests`, which avoids clobbering the process-global
/// provider base-url env vars shared by the saved-integrations test.
#[tokio::test]
async fn platform_brave_fallback_is_off_without_platform_key() {
    use aura_os_orgs::IntegrationSecretUpdate;

    // This test deliberately does NOT use `ProviderEnvGuard`: the unset-key
    // path fails before any provider HTTP call, so no provider mock is needed,
    // and we must not race the shared `AURA_*_API_BASE_URL` vars.
    let saved = std::env::var("BRAVE_SEARCH_PLATFORM_KEY").ok();
    unsafe { std::env::remove_var("BRAVE_SEARCH_PLATFORM_KEY") };

    let (app, state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    // Seed the gating-only synthetic platform brave integration into the local
    // shadow store. Its stored secret is a sentinel that must never be used —
    // the platform branch resolves from the env var instead.
    state
        .org_service
        .upsert_integration(
            &org_id,
            Some("platform-brave-search"),
            "Platform Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("shadow-should-not-be-used".to_string()),
        )
        .expect("seed synthetic platform integration");

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

    match saved {
        Some(value) => unsafe { std::env::set_var("BRAVE_SEARCH_PLATFORM_KEY", value) },
        None => unsafe { std::env::remove_var("BRAVE_SEARCH_PLATFORM_KEY") },
    }
}

#[tokio::test]
async fn disabled_workspace_integrations_are_kept_but_not_exposed_as_active_capabilities() {
    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Brave Search",
            "provider": "brave_search",
            "kind": "workspace_integration",
            "api_key": "brave_test",
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
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({
            "query": "aura"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

#[tokio::test]
async fn non_member_cannot_invoke_tool_actions() {
    // A-C1a: a user who is not a member of the org must be rejected by the
    // authorization gate before any provider dispatch occurs. The provider
    // env is intentionally NOT set up, so a successful response could only
    // mean dispatch happened — i.e. the guard failed to short-circuit.
    let (app, _state, _db) = build_test_app_without_org_membership().await;
    let org_id = OrgId::new();

    // App-provider tool path.
    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Special-case branch (list_org_integrations) must also be gated.
    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn authz_gate_fails_closed_on_upstream_500() {
    // A-C1a regression: the authZ gate must fail closed even when the
    // aura-network members endpoint itself returns a 5xx error. The
    // NetworkError::Server { status: 500 } arm of map_network_error propagates
    // the upstream status, so the response is 500 — never 200 (no dispatch).
    let (app, _state, _db) = build_test_app_with_members_upstream_error().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    // Upstream 500 → NetworkError::Server { status: 500 } → propagated as 500.
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn authz_gate_fails_closed_on_transport_failure() {
    // A-C1a regression: a transport error on the members lookup (connection
    // refused) must produce NetworkError::Request, caught by the _ arm of
    // map_network_error, which emits 502 Bad Gateway — never 200 (no dispatch).
    let (app, _state, _db) = build_test_app_with_members_transport_failure().await;
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    // Connection refused → NetworkError::Request → _ arm → 502 Bad Gateway.
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn tool_action_rate_limit_returns_429_after_burst() {
    // A-C1b: a burst of N+1 tool-action calls for one (user, org) must end in a
    // 429 once the per-(user, org) window limit is exceeded, and a *different*
    // org for the same user must remain unaffected (per-user AND per-org keying).
    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    let max = aura_os_server::tool_action_rate_limit::MAX_CALLS_PER_WINDOW;

    // `list_org_integrations` needs no provider env and returns 200 under-limit,
    // so it isolates the rate-limit behavior from provider dispatch.
    for _ in 0..max {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
            Some(serde_json::json!({})),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // The call that exceeds the window limit is rejected with 429.
    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "tool_action_rate_limited");

    // A different org (same user) is its own bucket and is not throttled.
    let other_org_id = OrgId::new();
    let req = json_request(
        "POST",
        &format!("/api/orgs/{other_org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
