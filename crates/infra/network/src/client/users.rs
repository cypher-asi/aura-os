use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

impl NetworkClient {
    pub async fn get_current_user(&self, jwt: &str) -> Result<NetworkUser, NetworkError> {
        self.get_authed(&format!("{}/api/users/me", self.base_url), jwt)
            .await
    }

    pub async fn get_user(&self, user_id: &str, jwt: &str) -> Result<NetworkUser, NetworkError> {
        self.get_authed(
            &format!("{}/api/users/{}", self.base_url, user_id),
            jwt,
        )
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
}
