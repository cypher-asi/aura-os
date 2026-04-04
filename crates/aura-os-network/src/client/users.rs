use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

impl NetworkClient {
    pub async fn get_current_user(&self, jwt: &str) -> Result<NetworkUser, NetworkError> {
        self.get_authed(&format!("{}/api/users/me", self.base_url), jwt)
            .await
    }

    pub async fn get_user(&self, user_id: &str, jwt: &str) -> Result<NetworkUser, NetworkError> {
        self.get_authed(&format!("{}/api/users/{}", self.base_url, user_id), jwt)
            .await
    }

    pub async fn update_current_user(
        &self,
        jwt: &str,
        req: &UpdateUserRequest,
    ) -> Result<NetworkUser, NetworkError> {
        self.put_authed(&format!("{}/api/users/me", self.base_url), jwt, req)
            .await
    }

    pub async fn get_user_profile(
        &self,
        user_id: &str,
        jwt: &str,
    ) -> Result<NetworkProfile, NetworkError> {
        self.get_authed(
            &format!("{}/api/users/{}/profile", self.base_url, user_id),
            jwt,
        )
        .await
    }

    pub async fn get_profile(
        &self,
        profile_id: &str,
        jwt: &str,
    ) -> Result<NetworkProfile, NetworkError> {
        self.get_authed(
            &format!("{}/api/profiles/{}", self.base_url, profile_id),
            jwt,
        )
        .await
    }

    pub async fn redeem_access_code(
        &self,
        jwt: &str,
        code: &str,
    ) -> Result<serde_json::Value, NetworkError> {
        self.post_authed(
            &format!("{}/api/access-codes/redeem", self.base_url),
            jwt,
            &serde_json::json!({ "code": code }),
        )
        .await
    }

    pub async fn grant_access(&self, jwt: &str) -> Result<(), NetworkError> {
        let url = format!("{}/api/access-codes/grant", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {jwt}"))
            .send()
            .await
            .map_err(NetworkError::Request)?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server { status, body });
        }
        Ok(())
    }

    pub async fn get_access_code(
        &self,
        jwt: &str,
    ) -> Result<serde_json::Value, NetworkError> {
        self.get_authed(
            &format!("{}/api/access-codes", self.base_url),
            jwt,
        )
        .await
    }
}
