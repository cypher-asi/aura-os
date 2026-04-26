use std::sync::Arc;

use aura_os_core::{OrgId, OrgIntegrationKind};
use aura_os_integrations::IntegrationsClient;
use aura_os_orgs::IntegrationSecretUpdate;

use super::super::secrets::load_integration_secret;
use super::start_mock_integrations_server;

#[tokio::test]
async fn canonical_secret_source_wins_over_local_shadow() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
        )
        .expect("save brave integration");

    let base_url =
        start_mock_integrations_server(Vec::new(), Some("canonical-remote-secret")).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let secret = load_integration_secret(&state, &org_id, &integration, None).await;
    assert_eq!(secret, Some("canonical-remote-secret".to_string()));
}

#[tokio::test]
async fn canonical_secret_falls_back_to_local_shadow_when_missing() {
    let store_dir = tempfile::tempdir().unwrap();
    let store_path = store_dir.path().join("store");
    let mut state = crate::build_app_state(&store_path).expect("build app state");
    let org_id = OrgId::new();

    let integration = state
        .org_service
        .upsert_integration(
            &org_id,
            None,
            "Brave Search".to_string(),
            "brave_search".to_string(),
            OrgIntegrationKind::WorkspaceIntegration,
            None,
            None,
            Some(true),
            IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
        )
        .expect("save brave integration");

    let base_url = start_mock_integrations_server(Vec::new(), None).await;
    state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
        &base_url,
        "internal-token",
    )));

    let secret = load_integration_secret(&state, &org_id, &integration, None).await;
    assert_eq!(secret, Some("local-shadow-secret".to_string()));
}
