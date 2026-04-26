//! Tests for `handlers::org_tools`.
//!
//! Relocated verbatim from the previous in-line `tests` module in
//! `org_tools.rs`; symbols are pulled from the parent `org_tools` module so
//! the assertions exercise the freshly split-out helpers without changing
//! their contracts.

use super::list::list_org_integrations;
use super::resolve::{resolve_mcp_server_integration, resolve_org_integration};
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
use std::sync::Arc;
use tokio::net::TcpListener;

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
                    Json(serde_json::json!({ "secret": secret }))
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

    let resolved = resolve_org_integration(&state, &org_id, "github", &serde_json::json!({}))
        .await
        .expect("resolve canonical provider integration");

    assert_eq!(resolved.metadata, canonical);
    assert_eq!(resolved.secret, "canonical-secret");
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
