use std::collections::HashMap;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};

use crate::state::AppState;

use super::secrets::load_integration_secret;

pub(crate) async fn provider_api_keys_for_model(
    state: &AppState,
    org_id: Option<&OrgId>,
    integrations: Option<&[OrgIntegration]>,
    bearer_token: Option<&str>,
    model: Option<&str>,
) -> HashMap<String, String> {
    let Some(provider) = provider_for_model(model) else {
        return HashMap::new();
    };
    let Some(org_id) = org_id else {
        return HashMap::new();
    };
    let Some(integrations) = integrations else {
        return HashMap::new();
    };

    let Some(integration) = integrations.iter().find(|integration| {
        integration.enabled
            && integration.has_secret
            && matches!(integration.kind, OrgIntegrationKind::WorkspaceConnection)
            && integration.provider.trim().eq_ignore_ascii_case(provider)
    }) else {
        return HashMap::new();
    };

    load_integration_secret(state, org_id, integration, bearer_token)
        .await
        .map(|secret| HashMap::from([(provider.to_string(), secret)]))
        .unwrap_or_default()
}

fn provider_for_model(model: Option<&str>) -> Option<&'static str> {
    let model = model?.trim().to_ascii_lowercase();
    if model.starts_with("aura-grok-")
        || model.starts_with("xai/grok-")
        || model.starts_with("grok-")
    {
        Some("xai")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use aura_os_core::{OrgId, OrgIntegrationKind};
    use aura_os_orgs::IntegrationSecretUpdate;

    use super::{provider_api_keys_for_model, provider_for_model};

    #[test]
    fn detects_xai_grok_model_aliases() {
        assert_eq!(provider_for_model(Some("aura-grok-4-3")), Some("xai"));
        assert_eq!(provider_for_model(Some("xai/grok-build-0.1")), Some("xai"));
        assert_eq!(provider_for_model(Some("grok-4.3")), Some("xai"));
        assert_eq!(provider_for_model(Some("aura-gpt-5-5")), None);
    }

    #[tokio::test]
    async fn loads_xai_workspace_connection_secret_for_grok_model() {
        let store_dir = tempfile::tempdir().unwrap();
        let store_path = store_dir.path().join("store");
        let state = crate::build_app_state(&store_path).expect("build app state");
        let org_id = OrgId::new();
        let integration = state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "xAI".to_string(),
                "xai".to_string(),
                OrgIntegrationKind::WorkspaceConnection,
                None,
                None,
                Some(true),
                IntegrationSecretUpdate::Set("xai-test-key".to_string()),
            )
            .expect("save xai integration");

        let keys = provider_api_keys_for_model(
            &state,
            Some(&org_id),
            Some(&[integration]),
            None,
            Some("aura-grok-4-3"),
        )
        .await;

        assert_eq!(keys.get("xai").map(String::as_str), Some("xai-test-key"));
    }
}
