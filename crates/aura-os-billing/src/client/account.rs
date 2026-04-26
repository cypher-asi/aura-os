//! Billing account lookup and auto-provisioning. Translates 404
//! responses into [`BillingError::AccountNotFound`] and fans out
//! through a small set of fallback paths to register the account if it
//! doesn't yet exist.

use reqwest::{Method, StatusCode};
use tracing::{debug, warn};

use aura_os_core::BillingAccount;

use crate::error::BillingError;

use super::BillingClient;

impl BillingClient {
    pub(super) async fn get_account_once(
        &self,
        access_token: &str,
    ) -> Result<BillingAccount, BillingError> {
        let url = format!("{}/v1/accounts/me", self.base_url);
        debug!(%url, "Fetching billing account");
        let resp = self
            .send_authed_json(Method::GET, "/v1/accounts/me", access_token, None)
            .await?;
        let status = resp.status();
        if status == StatusCode::NOT_FOUND {
            let body = resp.text().await.unwrap_or_default();
            warn!(status = status.as_u16(), %body, "z-billing error fetching account");
            return Err(BillingError::AccountNotFound { body });
        }
        self.json_or_server_error(resp, "z-billing error fetching account")
            .await
    }

    async fn provision_account(&self, access_token: &str) -> Result<(), BillingError> {
        for path in [
            "/v1/accounts",
            "/v1/accounts/register",
            "/v1/accounts/provision",
        ] {
            let resp = self
                .send_authed_json(
                    Method::POST,
                    path,
                    access_token,
                    Some(serde_json::json!({})),
                )
                .await?;
            let status = resp.status();
            if status.is_success() || status == StatusCode::CONFLICT {
                debug!(%path, status = status.as_u16(), "Provisioned billing account");
                return Ok(());
            }

            let body = resp.text().await.unwrap_or_default();
            if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
                debug!(
                    %path,
                    status = status.as_u16(),
                    %body,
                    "Billing provisioning endpoint unavailable, trying fallback"
                );
                continue;
            }

            warn!(
                %path,
                status = status.as_u16(),
                %body,
                "z-billing error provisioning account"
            );
            return Err(BillingError::AccountProvisioningFailed {
                status: status.as_u16(),
                body,
            });
        }

        Err(BillingError::AccountProvisioningFailed {
            status: StatusCode::NOT_FOUND.as_u16(),
            body: "no supported z-billing account provisioning endpoint found".to_string(),
        })
    }

    pub async fn ensure_account(&self, access_token: &str) -> Result<(), BillingError> {
        match self.get_account_once(access_token).await {
            Ok(_) => Ok(()),
            Err(BillingError::AccountNotFound { body }) => {
                debug!(%body, "Billing account missing, attempting auto-provision");
                self.provision_account(access_token).await?;
                self.get_account_once(access_token).await.map(|_| ())
            }
            Err(other) => Err(other),
        }
    }

    pub async fn get_account(&self, access_token: &str) -> Result<BillingAccount, BillingError> {
        self.ensure_account(access_token).await?;
        self.get_account_once(access_token).await
    }
}
