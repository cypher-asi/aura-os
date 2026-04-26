//! Pre-dispatch hydration of the local integration shadow.
//!
//! This mirrors the behaviour of the previous in-line
//! `hydrate_canonical_integration_shadow` helper from `org_tools.rs` exactly.

use aura_os_core::OrgId;
use aura_os_orgs::IntegrationSecretUpdate;
use tracing::warn;

use crate::state::AppState;

pub(super) async fn hydrate_canonical_integration_shadow(
    state: &AppState,
    org_id: &OrgId,
    jwt: &str,
) {
    let Some(client) = &state.integrations_client else {
        return;
    };

    let integrations = match client.list_integrations(org_id, jwt).await {
        Ok(integrations) => integrations,
        Err(error) => {
            warn!(
                %org_id,
                error = %error,
                "failed to hydrate canonical integration metadata before org tool dispatch"
            );
            return;
        }
    };

    if let Err(error) = state
        .org_service
        .sync_integrations_shadow(org_id, &integrations)
    {
        warn!(
            %org_id,
            error = %error,
            "failed to sync integration shadow before org tool dispatch"
        );
    }

    for integration in integrations
        .into_iter()
        .filter(|integration| integration.has_secret)
    {
        match client
            .get_integration_secret_authed(org_id, &integration.integration_id, jwt)
            .await
        {
            Ok(Some(secret)) if !secret.trim().is_empty() => {
                if let Err(error) = state
                    .org_service
                    .sync_integration_shadow(&integration, IntegrationSecretUpdate::Set(secret))
                {
                    warn!(
                        %org_id,
                        integration_id = %integration.integration_id,
                        error = %error,
                        "failed to sync integration secret shadow before org tool dispatch"
                    );
                }
            }
            Ok(_) => {}
            Err(error) => warn!(
                %org_id,
                integration_id = %integration.integration_id,
                error = %error,
                "failed to hydrate canonical integration secret before org tool dispatch"
            ),
        }
    }
}
