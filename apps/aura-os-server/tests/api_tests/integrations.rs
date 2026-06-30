use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

use super::integration_actions::*;
use super::integration_setup::{create_test_integrations, ProviderEnvGuard};

/// Serializes tests that mutate the process-global `BRAVE_SEARCH_PLATFORM_KEY`
/// so they never observe one another's writes under cargo's parallel test
/// threads. Mirrors the `env_lock` pattern in
/// `tests/remote_harness_base_url_test.rs`.
fn platform_key_env_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    &LOCK
}

/// RAII snapshot/restore guard for `BRAVE_SEARCH_PLATFORM_KEY`. Restores the
/// previous value (or unset state) on drop, so an assertion panic mid-test
/// cannot leak a dirty env var into another test. Mirrors `EnvGuard` in
/// `tests/remote_harness_base_url_test.rs`.
struct PlatformKeyEnvGuard {
    prev: Option<String>,
}

impl PlatformKeyEnvGuard {
    const KEY: &'static str = "BRAVE_SEARCH_PLATFORM_KEY";

    fn set(value: &str) -> Self {
        let prev = std::env::var(Self::KEY).ok();
        std::env::set_var(Self::KEY, value);
        Self { prev }
    }

    fn unset() -> Self {
        let prev = std::env::var(Self::KEY).ok();
        std::env::remove_var(Self::KEY);
        Self { prev }
    }
}

impl Drop for PlatformKeyEnvGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(Self::KEY, value),
            None => std::env::remove_var(Self::KEY),
        }
    }
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn org_tool_actions_use_saved_integrations() {
    // Serialize with the platform e2e (the other ProviderEnvGuard user) so the
    // shared provider base-URL env vars are never torn down mid-request; keep the
    // platform key unset so this exercises the saved-key path, not the synthesis.
    let _lock = platform_key_env_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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

/// Spec 02 §9 soft-fallback at the HTTP dispatch layer: when the only brave
/// integration available is the reserved synthetic platform id and
/// `BRAVE_SEARCH_PLATFORM_KEY` is unset, the tool-action endpoint fails cleanly
/// (clean 4xx, no panic) — the feature is effectively off. The success path
/// (env set → platform key resolves) is proven by the unit-level precedence
/// test in `org_tools::tests`, which avoids clobbering the process-global
/// provider base-url env vars shared by the saved-integrations test.
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn platform_brave_fallback_is_off_without_platform_key() {
    use aura_os_orgs::IntegrationSecretUpdate;

    // This test deliberately does NOT use `ProviderEnvGuard`: the unset-key
    // path fails before any provider HTTP call, so no provider mock is needed,
    // and we must not race the shared `AURA_*_API_BASE_URL` vars. We hold the
    // platform-key lock across `.await` so a concurrent test cannot flip
    // `BRAVE_SEARCH_PLATFORM_KEY` while we drive the unset-key path.
    let _lock = platform_key_env_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let _env = PlatformKeyEnvGuard::unset();

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
}

/// Spec 02 Gate C: the gating-only synthetic platform Brave integration is
/// injected solely into the agent capabilities builder, never into the
/// storage-backed feed behind `GET /api/orgs/{id}/integrations`. So even with
/// `BRAVE_SEARCH_PLATFORM_KEY` SET, the REST list must be unchanged: exactly
/// the 12 saved integrations, and the reserved `platform-brave-search` id must
/// not appear. Holds by construction; pinned here so a future regression that
/// leaks the synthetic into the REST feed fails loudly.
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn platform_key_set_does_not_leak_synthetic_into_rest_list() {
    let _lock = platform_key_env_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
        "the gating-only synthetic platform-brave-search id must never appear in the REST list"
    );
}

/// Spec 02 end-to-end (web): with `BRAVE_SEARCH_PLATFORM_KEY` set and NO real
/// org brave key, a brave tool-action resolves the *platform* key (not a saved
/// secret), dispatches the outbound Brave call to the provider mock, and
/// returns shaped results. This exercises the execution half of the feature
/// that no single test covers: platform-key resolution in
/// `load_org_integration_secret` (the synthetic id short-circuits before any
/// shadow secret is read) → outbound Brave via mock → transform → 200. (Tool
/// *emission* — GATE A — is a separate surface, proven by the unit-level
/// `installed_workspace_app_tools` tests; the tool-action endpoint dispatches
/// by name and does not re-run emission filtering.)
///
/// No org brave integration is seeded and no `integration_id` is passed — this is
/// exactly the production path (a real agent calls `brave_search_web` with just a
/// query). Resolution must synthesize the gating-only platform integration
/// in-memory (Gate D) so the platform-key branch in `load_org_integration_secret`
/// is reached; the synthetic is never written to storage. Complements (does not
/// duplicate) the unit-level emission and soft-fallback tests.
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn platform_key_brave_tool_action_resolves_platform_key_end_to_end() {
    // The tool-action dispatches an outbound Brave call, so the provider mock
    // must back `AURA_BRAVE_SEARCH_API_BASE_URL` (same setup as
    // `org_tool_actions_use_saved_integrations` / `assert_brave_actions`).
    // Hold the brave-test lock outermost (released last) so the provider mock's
    // base-URL env vars and the platform key are never mutated/torn down by a
    // concurrent brave test mid-request.
    let _lock = platform_key_env_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let _env_provider = ProviderEnvGuard::set_up().await;
    let _env = PlatformKeyEnvGuard::set("platform-key-123");

    let (app, _state, _db) = build_test_app_with_org_membership().await;
    let org_id = OrgId::new();

    // Production path: NO org brave integration in storage and NO integration_id
    // in the call. Resolution must synthesize the platform brave integration and
    // load the key from BRAVE_SEARCH_PLATFORM_KEY.
    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let brave_web = response_json(resp).await;
    assert_eq!(brave_web["results"][0]["title"], "Brave result");

    // News search: same platform-key path, distinct mock route.
    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_news"),
        Some(serde_json::json!({ "query": "aura" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let brave_news = response_json(resp).await;
    assert_eq!(brave_news["results"][0]["title"], "Brave news");
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn disabled_workspace_integrations_are_kept_but_not_exposed_as_active_capabilities() {
    // Keep the platform key unset (and serialized) so Gate D synthesis can't turn
    // this disabled-integration path into a platform fallback.
    let _lock = platform_key_env_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let _platform_off = PlatformKeyEnvGuard::unset();
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
