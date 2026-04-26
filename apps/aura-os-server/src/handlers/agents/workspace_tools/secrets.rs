use tracing::warn;

use aura_os_core::{OrgId, OrgIntegration};

use crate::state::AppState;

pub(super) async fn load_integration_secret(
    state: &AppState,
    org_id: &OrgId,
    integration: &OrgIntegration,
    bearer_token: Option<&str>,
) -> Option<String> {
    if let Some(client) = &state.integrations_client {
        let canonical = if let Some(jwt) = bearer_token {
            client
                .get_integration_secret_authed(org_id, &integration.integration_id, jwt)
                .await
        } else {
            client
                .get_integration_secret(org_id, &integration.integration_id)
                .await
        };
        match canonical {
            Ok(secret) => {
                if let Some(secret) = secret.filter(|value| !value.trim().is_empty()) {
                    return Some(secret);
                }
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    provider = %integration.provider,
                    "canonical aura-integrations secret missing or empty"
                );
            }
            Err(error) => warn!(
                %org_id,
                integration_id = %integration.integration_id,
                provider = %integration.provider,
                error = %error,
                "failed to load canonical aura-integrations secret"
            ),
        }
    }
    state
        .org_service
        .get_integration_secret(&integration.integration_id)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
}
