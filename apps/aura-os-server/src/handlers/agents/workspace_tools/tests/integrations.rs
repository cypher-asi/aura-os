use std::sync::Arc;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_integrations::IntegrationsClient;
use aura_os_orgs::IntegrationSecretUpdate;

use super::super::integrations::integrations_for_org_with_token;
use super::super::secrets::load_integration_secret;
use super::start_mock_public_integrations_server;

#[tokio::test]
async fn jwt_backed_integrations_for_org_uses_public_routes() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();
    let canonical = OrgIntegration {
        integration_id: "canonical-brave".to_string(),
        org_id,
        name: "Canonical Brave".to_string(),
        provider: "brave_search".to_string(),
        kind: OrgIntegrationKind::WorkspaceIntegration,
        default_model: None,
        provider_config: None,
        has_secret: true,
        enabled: true,
        secret_last4: Some("1234".to_string()),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    let base_url = start_mock_public_integrations_server(
        "jwt-123",
        vec![canonical.clone()],
        Some("canonical-remote-secret"),
    )
    .await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "unused-internal-token",
    )));

    let integrations = integrations_for_org_with_token(&state, &org_id, Some("jwt-123")).await;
    assert_eq!(integrations.len(), 1);
    assert_eq!(integrations[0].integration_id, canonical.integration_id);
    assert_eq!(integrations[0].provider, "brave_search");
}

#[tokio::test]
async fn jwt_backed_secret_load_uses_public_routes() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();
    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            Some("canonical-brave"),
            "Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
        )
        .expect("save brave integration");

    let base_url = start_mock_public_integrations_server(
        "jwt-123",
        vec![integration.clone()],
        Some("canonical-remote-secret"),
    )
    .await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "unused-internal-token",
    )));

    let secret = load_integration_secret(&state, &org_id, &integration, Some("jwt-123")).await;
    assert_eq!(secret, Some("canonical-remote-secret".to_string()));
}
