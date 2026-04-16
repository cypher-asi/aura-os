use tracing::{debug, warn};

use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

impl NetworkClient {
    pub async fn get_leaderboard(
        &self,
        period: &str,
        org_id: Option<&str>,
        jwt: &str,
    ) -> Result<Vec<LeaderboardEntry>, NetworkError> {
        let mut url = format!("{}/api/leaderboard?period={}", self.base_url, period);
        if let Some(oid) = org_id {
            url.push_str(&format!("&org_id={}", oid));
        }
        self.get_authed(&url, jwt).await
    }

    pub async fn get_personal_usage(
        &self,
        period: &str,
        jwt: &str,
    ) -> Result<UsageStats, NetworkError> {
        self.get_authed(
            &format!("{}/api/users/me/usage?period={}", self.base_url, period),
            jwt,
        )
        .await
    }

    pub async fn get_org_usage(
        &self,
        org_id: &str,
        period: &str,
        jwt: &str,
    ) -> Result<UsageStats, NetworkError> {
        self.get_authed(
            &format!(
                "{}/api/orgs/{}/usage?period={}",
                self.base_url, org_id, period
            ),
            jwt,
        )
        .await
    }

    pub async fn get_org_usage_members(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<MemberUsageStats>, NetworkError> {
        self.get_authed(
            &format!("{}/api/orgs/{}/usage/members", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn get_platform_stats(
        &self,
        jwt: &str,
    ) -> Result<Option<PlatformStats>, NetworkError> {
        // Fetch raw body so we can log the exact keys the remote aura-network
        // service returns. This helps catch key-name mismatches (e.g. the
        // remote emitting `projectCount` while we expect `projectsCreated`)
        // that silently decode to 0 via `#[serde(default)]`.
        let url = format!("{}/api/stats", self.base_url);
        let resp = self.http.get(&url).bearer_auth(jwt).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body = resp
            .text()
            .await
            .map_err(|e| NetworkError::Deserialize(e.to_string()))?;
        debug!(%url, body = %body, "platform_stats raw response");
        serde_json::from_str::<Option<PlatformStats>>(&body).map_err(|e| {
            warn!(%url, error = %e, "platform_stats deserialization failed");
            NetworkError::Deserialize(e.to_string())
        })
    }

    pub async fn report_usage(
        &self,
        req: &crate::types::ReportUsageRequest,
        jwt: &str,
    ) -> Result<(), NetworkError> {
        let url = format!("{}/api/usage", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(jwt)
            .json(req)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }
}
