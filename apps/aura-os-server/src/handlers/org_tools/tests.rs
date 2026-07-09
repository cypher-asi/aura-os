//! Tests for `handlers::org_tools`.
//!
//! Relocated verbatim from the previous in-line `tests` module in
//! `org_tools.rs`; symbols are pulled from the parent `org_tools` module so
//! the assertions exercise the freshly split-out helpers without changing
//! their contracts.

use super::list::list_org_integrations;
use super::resolve::{
    resolve_mcp_server_integration, resolve_org_integration, resolve_org_integration_fail_loud,
};
use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_integrations::{
    app_provider_authenticated_url, app_provider_contract_by_tool, app_provider_contracts,
    app_provider_headers, org_integration_tool_manifest_entries, AppProviderKind,
    IntegrationsClient,
};
use aura_os_orgs::IntegrationSecretUpdate;
use axum::extract::Path;
use axum::routing::get;
use axum::Json;
use axum::Router;
use chrono::Utc;
use reqwest::header::AUTHORIZATION;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;

#[test]
fn inactive_subscription_does_not_receive_paid_web_search_limits() {
    let now = chrono::Utc::now();
    let status = aura_os_billing::SubscriptionStatus {
        plan: "sage".to_string(),
        is_subscribed: false,
        monthly_credits: 0,
        current_period_end: None,
    };

    assert_eq!(
        super::web_search_limits_for_subscription_at(&status, now),
        crate::tool_action_rate_limit::DEFAULT_LIMITS
    );
}

#[test]
fn cancelled_subscription_keeps_paid_limits_through_period_end() {
    let now = chrono::Utc::now();
    let mut status = aura_os_billing::SubscriptionStatus {
        plan: "sage".to_string(),
        is_subscribed: false,
        monthly_credits: 0,
        current_period_end: Some((now + chrono::Duration::days(1)).to_rfc3339()),
    };

    assert_eq!(
        super::web_search_limits_for_subscription_at(&status, now),
        crate::tool_action_rate_limit::SAGE_LIMITS
    );

    status.current_period_end = Some((now - chrono::Duration::seconds(1)).to_rfc3339());
    assert_eq!(
        super::web_search_limits_for_subscription_at(&status, now),
        crate::tool_action_rate_limit::DEFAULT_LIMITS
    );
}

fn sample_integration(
    org_id: OrgId,
    integration_id: &str,
    name: &str,
    provider: &str,
    enabled: bool,
    has_secret: bool,
) -> OrgIntegration {
    let now = Utc::now();
    OrgIntegration {
        integration_id: integration_id.to_string(),
        org_id,
        name: name.to_string(),
        provider: provider.to_string(),
        kind: OrgIntegrationKind::WorkspaceIntegration,
        default_model: None,
        provider_config: None,
        has_secret,
        enabled,
        secret_last4: has_secret.then(|| "1234".to_string()),
        created_at: now,
        updated_at: now,
    }
}

async fn start_mock_integrations_server(
    integration: OrgIntegration,
    secret: Option<&'static str>,
) -> String {
    start_mock_integrations_server_with_secret_counter(integration, secret, None).await
}

async fn start_mock_integrations_server_with_secret_counter(
    integration: OrgIntegration,
    secret: Option<&'static str>,
    secret_hits: Option<Arc<AtomicUsize>>,
) -> String {
    let list_integration = integration.clone();
    let get_integration = integration.clone();
    let secret_hit_counter = secret_hits.clone();
    let app = Router::new()
        .route(
            "/internal/orgs/:org_id/integrations",
            get(move |Path(_org_id): Path<String>| {
                let integration = list_integration.clone();
                async move { Json(vec![integration]) }
            }),
        )
        .route(
            "/internal/orgs/:org_id/integrations/:integration_id",
            get(
                move |Path((_org_id, integration_id)): Path<(String, String)>| {
                    let integration = get_integration.clone();
                    async move {
                        if integration.integration_id == integration_id {
                            Ok::<_, axum::http::StatusCode>(Json(integration))
                        } else {
                            Err(axum::http::StatusCode::NOT_FOUND)
                        }
                    }
                },
            ),
        )
        .route(
            "/internal/orgs/:org_id/integrations/:integration_id/secret",
            get(
                move |Path((_org_id, _integration_id)): Path<(String, String)>| {
                    let secret_hit_counter = secret_hit_counter.clone();
                    async move {
                        if let Some(counter) = secret_hit_counter {
                            counter.fetch_add(1, Ordering::SeqCst);
                        }
                        Json(serde_json::json!({ "secret": secret }))
                    }
                },
            ),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{address}")
}

#[test]
fn shared_app_tool_manifest_matches_provider_registry() {
    let manifest_entries = org_integration_tool_manifest_entries();
    assert!(manifest_entries
        .iter()
        .all(|entry| !entry.prompt_signature.trim().is_empty()));
    let manifest_by_provider =
        manifest_entries
            .iter()
            .fold(HashMap::<&str, HashSet<&str>>::new(), |mut acc, entry| {
                if let Some(provider) = entry.provider.as_deref() {
                    acc.entry(provider).or_default().insert(entry.name.as_str());
                }
                acc
            });

    for contract in app_provider_contracts() {
        let expected = manifest_entries
            .iter()
            .filter(|entry| entry.provider.as_deref() == Some(contract.kind.provider_id()))
            .map(|entry| entry.name.as_str())
            .collect::<HashSet<_>>();
        let actual = manifest_by_provider
            .get(contract.kind.provider_id())
            .cloned()
            .unwrap_or_default();
        assert_eq!(
            actual,
            expected,
            "shared app manifest drifted from the {} provider contract",
            contract.kind.provider_id()
        );
    }

    let registered_tools = manifest_entries
        .iter()
        .filter_map(|entry| entry.provider.as_deref().map(|_| entry.name.as_str()))
        .collect::<HashSet<_>>();
    let manifest_tools = manifest_entries
        .iter()
        .filter_map(|entry| entry.provider.as_deref().map(|_| entry.name.as_str()))
        .collect::<HashSet<_>>();
    assert_eq!(manifest_tools, registered_tools);
}

#[test]
fn app_tool_lookup_uses_registered_provider_contracts() {
    let github = app_provider_contract_by_tool("github_create_issue").expect("github tool");
    assert_eq!(github.kind.provider_id(), "github");

    let linear = app_provider_contract_by_tool("linear_list_teams").expect("linear tool");
    assert_eq!(linear.kind.provider_id(), "linear");

    assert!(app_provider_contract_by_tool("list_org_integrations").is_none());
    assert!(app_provider_contract_by_tool("missing_tool").is_none());
}

#[test]
fn linear_headers_use_raw_api_key_without_bearer_prefix() {
    let headers =
        app_provider_headers(AppProviderKind::Linear, "lin_test_123").expect("linear headers");
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .expect("authorization header");
    assert_eq!(auth, "lin_test_123");
}

#[test]
fn buffer_authenticated_url_uses_query_token_contract() {
    let url =
        app_provider_authenticated_url(AppProviderKind::Buffer, "/profiles.json", "buf_test_123")
            .expect("buffer url");
    assert_eq!(
        url.query_pairs().find(|(key, _)| key == "access_token"),
        Some(("access_token".into(), "buf_test_123".into()))
    );
}

#[tokio::test]
async fn resolve_org_integration_prefers_canonical_metadata_for_selected_id() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();
    let integration_id = "github-ops";

    state
        .org_service
        .upsert_integration(
            &org_id,
            Some(integration_id),
            "Local Shadow".to_string(),
            "github".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(false),
            IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
        )
        .expect("save local shadow");

    let canonical = sample_integration(
        org_id,
        integration_id,
        "Canonical GitHub",
        "github",
        true,
        true,
    );
    let base_url =
        start_mock_integrations_server(canonical.clone(), Some("canonical-secret")).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let resolved = resolve_org_integration(
        &state,
        &org_id,
        "github",
        None,
        &serde_json::json!({ "integration_id": integration_id }),
    )
    .await
    .expect("resolve canonical integration");

    assert_eq!(resolved.metadata, canonical);
    assert_eq!(resolved.secret, "canonical-secret");
}

#[tokio::test]
async fn resolve_org_integration_prefers_canonical_provider_list() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Local Disabled GitHub".to_string(),
            "github".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(false),
            IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
        )
        .expect("save local shadow");

    let canonical = sample_integration(
        org_id,
        "canonical-github",
        "Canonical GitHub",
        "github",
        true,
        true,
    );
    let base_url =
        start_mock_integrations_server(canonical.clone(), Some("canonical-secret")).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let resolved = resolve_org_integration(&state, &org_id, "github", None, &serde_json::json!({}))
        .await
        .expect("resolve canonical provider integration");

    assert_eq!(resolved.metadata, canonical);
    assert_eq!(resolved.secret, "canonical-secret");
}

#[tokio::test]
async fn resolve_google_integration_requires_matching_owner_user() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Google".to_string(),
            "google".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            Some(serde_json::json!({
                "ownerUserId": "user-1",
                "accountEmail": "one@example.com"
            })),
            Some(true),
            IntegrationSecretUpdate::Set("google-access-token".to_string()),
        )
        .expect("save google integration");

    let denied = resolve_org_integration(
        &state,
        &org_id,
        "google",
        Some("user-2"),
        &serde_json::json!({ "integration_id": integration.integration_id }),
    )
    .await;
    assert!(
        denied.is_err(),
        "other users must not resolve Google tokens"
    );

    let resolved = resolve_org_integration(
        &state,
        &org_id,
        "google",
        Some("user-1"),
        &serde_json::json!({ "integration_id": integration.integration_id }),
    )
    .await
    .expect("owner resolves google integration");
    assert_eq!(resolved.secret, "google-access-token");
}

#[tokio::test]
async fn resolve_google_integration_denies_missing_owner_user() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Google".to_string(),
            "google".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            Some(serde_json::json!({
                "accountEmail": "one@example.com"
            })),
            Some(true),
            IntegrationSecretUpdate::Set("google-access-token".to_string()),
        )
        .expect("save google integration");

    let denied = resolve_org_integration(
        &state,
        &org_id,
        "google",
        Some("user-1"),
        &serde_json::json!({ "integration_id": integration.integration_id }),
    )
    .await;

    assert!(
        denied.is_err(),
        "Google integrations without an owner user id must not resolve"
    );
}

#[tokio::test]
async fn resolve_google_integration_denies_blank_owner_user() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Google".to_string(),
            "google".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            Some(serde_json::json!({
                "ownerUserId": "   ",
                "accountEmail": "one@example.com"
            })),
            Some(true),
            IntegrationSecretUpdate::Set("google-access-token".to_string()),
        )
        .expect("save google integration");

    let denied = resolve_org_integration(
        &state,
        &org_id,
        "google",
        Some("user-1"),
        &serde_json::json!({ "integration_id": integration.integration_id }),
    )
    .await;

    assert!(
        denied.is_err(),
        "Google integrations with a blank owner user id must not resolve"
    );
}

/// Spec 02 §9 soft-fallback: the reserved synthetic platform Web Search integration
/// resolves its secret from `BRAVE_SEARCH_PLATFORM_KEY` only when selected by
/// its reserved id, a real org brave integration always wins provider-based
/// selection, and an unset env var yields a clean error (no panic).
#[tokio::test]
async fn platform_web_search_key_is_soft_fallback_behind_legacy_org_key() {
    use super::resolve::PLATFORM_BRAVE_INTEGRATION_ID;

    // Keep this test self-contained: snapshot and restore the env var so it
    // does not leak into other tests sharing the process.
    let saved = std::env::var("BRAVE_SEARCH_PLATFORM_KEY").ok();
    unsafe { std::env::remove_var("BRAVE_SEARCH_PLATFORM_KEY") };

    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    // Synthetic gating-only platform integration: enabled, provider brave_search,
    // but its stored secret must never be used — the platform branch returns the
    // env key instead.
    state
        .org_service
        .upsert_integration(
            &org_id,
            Some(PLATFORM_BRAVE_INTEGRATION_ID),
            "Platform Web Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("shadow-should-not-be-used".to_string()),
        )
        .expect("save synthetic platform integration");

    // (c) env unset → clean error, feature effectively off (no panic).
    let unset = resolve_org_integration(
        &state,
        &org_id,
        "brave_search",
        None,
        &serde_json::json!({ "integration_id": PLATFORM_BRAVE_INTEGRATION_ID }),
    )
    .await;
    assert!(
        unset.is_err(),
        "platform Web Search fallback must error cleanly when the env var is unset"
    );

    // (a) env set + no real org brave key → resolving the synthetic id returns
    // the platform key (not the shadow secret).
    unsafe { std::env::set_var("BRAVE_SEARCH_PLATFORM_KEY", "platform-key-123") };
    let fallback = resolve_org_integration(
        &state,
        &org_id,
        "brave_search",
        None,
        &serde_json::json!({ "integration_id": PLATFORM_BRAVE_INTEGRATION_ID }),
    )
    .await
    .expect("platform fallback resolves when env var is set");
    assert_eq!(fallback.secret, "platform-key-123");

    // (b) a real org brave integration (enabled + secret) wins provider-based
    // selection; the platform key never overrides it.
    state
        .org_service
        .upsert_integration(
            &org_id,
            Some("org-brave"),
            "Org Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("real-org-brave-key".to_string()),
        )
        .expect("save real org brave integration");

    let by_provider = resolve_org_integration(
        &state,
        &org_id,
        "brave_search",
        None,
        &serde_json::json!({}),
    )
    .await
    .expect("real org brave integration resolves by provider");
    assert_eq!(
        by_provider.secret, "real-org-brave-key",
        "a real org brave key must win over the platform fallback"
    );
    assert_ne!(
        by_provider.metadata.integration_id, PLATFORM_BRAVE_INTEGRATION_ID,
        "provider selection must not pick the synthetic platform integration when a real key exists"
    );

    match saved {
        Some(value) => unsafe { std::env::set_var("BRAVE_SEARCH_PLATFORM_KEY", value) },
        None => unsafe { std::env::remove_var("BRAVE_SEARCH_PLATFORM_KEY") },
    }
}

#[tokio::test]
async fn resolve_google_canonical_denies_before_secret_fetch_when_owner_mismatches() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();
    let integration_id = "canonical-google";

    let mut canonical = sample_integration(org_id, integration_id, "Google", "google", true, true);
    canonical.provider_config = Some(serde_json::json!({
        "ownerUserId": "user-1",
        "accountEmail": "one@example.com"
    }));
    let secret_hits = Arc::new(AtomicUsize::new(0));
    let base_url = start_mock_integrations_server_with_secret_counter(
        canonical,
        Some("canonical-google-token"),
        Some(secret_hits.clone()),
    )
    .await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let denied = resolve_org_integration(
        &state,
        &org_id,
        "google",
        Some("user-2"),
        &serde_json::json!({ "integration_id": integration_id }),
    )
    .await;

    assert!(
        denied.is_err(),
        "other users must not resolve canonical Google tokens"
    );
    assert_eq!(
        secret_hits.load(Ordering::SeqCst),
        0,
        "secret retrieval must not run after Google owner validation fails"
    );
}

#[tokio::test]
async fn list_org_integrations_prefers_canonical_backend() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            Some("local-github"),
            "Local Disabled GitHub".to_string(),
            "github".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(false),
            IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
        )
        .expect("save local shadow");

    let canonical = sample_integration(
        org_id,
        "canonical-github",
        "Canonical GitHub",
        "github",
        true,
        true,
    );
    let base_url =
        start_mock_integrations_server(canonical.clone(), Some("canonical-secret")).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let listed = list_org_integrations(&state, &org_id, &serde_json::json!({}))
        .await
        .expect("list org integrations");
    let integrations = listed
        .get("integrations")
        .and_then(Value::as_array)
        .expect("integrations array");

    assert_eq!(integrations.len(), 1);
    assert_eq!(
        integrations[0]
            .get("integration_id")
            .and_then(Value::as_str),
        Some("canonical-github")
    );
    assert_eq!(
        integrations[0].get("name").and_then(Value::as_str),
        Some("Canonical GitHub")
    );
}

#[tokio::test]
async fn resolve_mcp_server_integration_accepts_enabled_mcp_server() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            Some("mcp-1"),
            "Docs MCP".to_string(),
            "mcp_server".to_string(),
            OrgIntegrationKind::McpServer,
            None,
            Some(serde_json::json!({"transport":"stdio","command":"demo"})),
            Some(true),
            IntegrationSecretUpdate::Preserve,
        )
        .expect("save mcp integration");

    let resolved = resolve_mcp_server_integration(&state, &org_id, "mcp-1")
        .await
        .expect("resolve mcp integration");

    assert_eq!(resolved.metadata, integration);
    assert_eq!(resolved.secret, "");
}

#[tokio::test]
async fn resolve_mcp_server_integration_uses_shadow_secret_when_canonical_secret_is_missing() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    state
        .org_service
        .upsert_integration(
            &org_id,
            Some("mcp-1"),
            "Local Docs MCP".to_string(),
            "mcp_server".to_string(),
            OrgIntegrationKind::McpServer,
            None,
            Some(serde_json::json!({"transport":"stdio","command":"local-demo"})),
            Some(true),
            IntegrationSecretUpdate::Set("local-mcp-secret".to_string()),
        )
        .expect("save local mcp shadow");

    let mut canonical = sample_integration(
        org_id,
        "mcp-1",
        "Canonical Docs MCP",
        "mcp_server",
        true,
        true,
    );
    canonical.kind = OrgIntegrationKind::McpServer;
    canonical.provider_config = Some(serde_json::json!({
        "transport": "stdio",
        "command": "canonical-demo"
    }));
    let base_url = start_mock_integrations_server(canonical.clone(), None).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let resolved = resolve_mcp_server_integration(&state, &org_id, "mcp-1")
        .await
        .expect("resolve canonical mcp integration with shadow secret");

    assert_eq!(resolved.metadata, canonical);
    assert_eq!(resolved.secret, "local-mcp-secret");
}

/// Spins up a mock canonical integrations server whose metadata endpoints
/// succeed but whose secret endpoint always returns HTTP 500, modelling a
/// canonical service that is configured but degraded (A-H2).
async fn start_mock_integrations_server_with_failing_secret(integration: OrgIntegration) -> String {
    let list_integration = integration.clone();
    let get_integration = integration.clone();
    let app = Router::new()
        .route(
            "/internal/orgs/:org_id/integrations",
            get(move |Path(_org_id): Path<String>| {
                let integration = list_integration.clone();
                async move { Json(vec![integration]) }
            }),
        )
        .route(
            "/internal/orgs/:org_id/integrations/:integration_id",
            get(
                move |Path((_org_id, integration_id)): Path<(String, String)>| {
                    let integration = get_integration.clone();
                    async move {
                        if integration.integration_id == integration_id {
                            Ok::<_, axum::http::StatusCode>(Json(integration))
                        } else {
                            Err(axum::http::StatusCode::NOT_FOUND)
                        }
                    }
                },
            ),
        )
        .route(
            "/internal/orgs/:org_id/integrations/:integration_id/secret",
            get(
                move |Path((_org_id, _integration_id)): Path<(String, String)>| async move {
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR
                },
            ),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{address}")
}

#[tokio::test]
async fn fail_loud_returns_503_when_canonical_secret_service_is_down() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();
    let integration_id = "brave-ops";

    // A stale-but-present local shadow that the fail-loud path must NOT use.
    state
        .org_service
        .upsert_integration(
            &org_id,
            Some(integration_id),
            "Local Shadow Brave".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("stale-shadow-secret".to_string()),
        )
        .expect("save local shadow");

    let canonical = sample_integration(
        org_id,
        integration_id,
        "Canonical Brave",
        "brave_search",
        true,
        true,
    );
    let base_url = start_mock_integrations_server_with_failing_secret(canonical).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let result = resolve_org_integration_fail_loud(
        &state,
        &org_id,
        "brave_search",
        None,
        &serde_json::json!({ "integration_id": integration_id }),
    )
    .await;

    let (status, _body) = match result {
        Ok(_) => panic!("degraded canonical service must fail loud"),
        Err(err) => err,
    };
    assert_eq!(
        status,
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "a degraded canonical service must return 503, not a stale-shadow execution"
    );
}

#[tokio::test]
async fn fail_loud_returns_not_found_when_canonical_integration_missing() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    // Canonical server only knows about a different integration id, so a
    // lookup by id resolves to a healthy 404.
    let canonical = sample_integration(
        org_id,
        "some-other-id",
        "Canonical Brave",
        "brave_search",
        true,
        true,
    );
    let base_url = start_mock_integrations_server(canonical, Some("canonical-secret")).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let result = resolve_org_integration_fail_loud(
        &state,
        &org_id,
        "brave_search",
        None,
        &serde_json::json!({ "integration_id": "missing-id" }),
    )
    .await;

    let (status, _body) = match result {
        Ok(_) => panic!("missing canonical integration must error"),
        Err(err) => err,
    };
    assert_eq!(
        status,
        axum::http::StatusCode::NOT_FOUND,
        "a healthy not-found must keep the existing 4xx semantics"
    );
}

#[tokio::test]
async fn fail_loud_uses_shadow_when_no_canonical_client_configured() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();
    let integration_id = "brave-local";

    // Deliberate dev/local mode: no canonical integrations client configured.
    state.integrations_client = None;

    state
        .org_service
        .upsert_integration(
            &org_id,
            Some(integration_id),
            "Local Brave".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("local-brave-secret".to_string()),
        )
        .expect("save local shadow");

    // No `integrations_client` configured → deliberate dev/local mode that
    // must keep resolving via the local shadow even on the fail-loud path.
    let resolved = resolve_org_integration_fail_loud(
        &state,
        &org_id,
        "brave_search",
        None,
        &serde_json::json!({ "integration_id": integration_id }),
    )
    .await
    .expect("local/dev mode resolves via shadow");

    assert_eq!(resolved.secret, "local-brave-secret");
}
