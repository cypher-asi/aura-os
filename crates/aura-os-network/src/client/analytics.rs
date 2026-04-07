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
        self.get_authed(&format!("{}/api/stats", self.base_url), jwt)
            .await
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
