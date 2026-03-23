use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

impl NetworkClient {
    pub async fn create_org(
        &self,
        jwt: &str,
        req: &CreateOrgRequest,
    ) -> Result<NetworkOrg, NetworkError> {
        self.post_authed(&format!("{}/api/orgs", self.base_url), jwt, req)
            .await
    }

    pub async fn list_orgs(&self, jwt: &str) -> Result<Vec<NetworkOrg>, NetworkError> {
        self.get_authed(&format!("{}/api/orgs", self.base_url), jwt)
            .await
    }

    pub async fn get_org(&self, org_id: &str, jwt: &str) -> Result<NetworkOrg, NetworkError> {
        self.get_authed(&format!("{}/api/orgs/{}", self.base_url, org_id), jwt)
            .await
    }

    pub async fn update_org(
        &self,
        org_id: &str,
        jwt: &str,
        req: &UpdateOrgRequest,
    ) -> Result<NetworkOrg, NetworkError> {
        self.put_authed(&format!("{}/api/orgs/{}", self.base_url, org_id), jwt, req)
            .await
    }

    pub async fn list_org_members(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkOrgMember>, NetworkError> {
        self.get_authed(
            &format!("{}/api/orgs/{}/members", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn update_org_member(
        &self,
        org_id: &str,
        user_id: &str,
        jwt: &str,
        req: &UpdateMemberRequest,
    ) -> Result<NetworkOrgMember, NetworkError> {
        self.put_authed(
            &format!("{}/api/orgs/{}/members/{}", self.base_url, org_id, user_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn remove_org_member(
        &self,
        org_id: &str,
        user_id: &str,
        jwt: &str,
    ) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/orgs/{}/members/{}", self.base_url, org_id, user_id),
            jwt,
        )
        .await
    }

    pub async fn create_invite(
        &self,
        org_id: &str,
        jwt: &str,
        req: &CreateInviteRequest,
    ) -> Result<NetworkOrgInvite, NetworkError> {
        self.post_authed(
            &format!("{}/api/orgs/{}/invites", self.base_url, org_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_invites(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkOrgInvite>, NetworkError> {
        self.get_authed(
            &format!("{}/api/orgs/{}/invites", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn revoke_invite(
        &self,
        org_id: &str,
        invite_id: &str,
        jwt: &str,
    ) -> Result<(), NetworkError> {
        let url = format!(
            "{}/api/orgs/{}/invites/{}",
            self.base_url, org_id, invite_id
        );
        self.delete_authed(&url, jwt).await
    }

    pub async fn accept_invite(
        &self,
        token: &str,
        jwt: &str,
    ) -> Result<NetworkOrgMember, NetworkError> {
        self.post_authed(
            &format!("{}/api/invites/{}/accept", self.base_url, token),
            jwt,
            &serde_json::json!({}),
        )
        .await
    }
}
