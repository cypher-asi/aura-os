mod error;
pub use error::GitHubError;

use std::sync::Arc;

use chrono::{Duration, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use tracing::info;

use aura_core::*;
use aura_store::RocksStore;
use aura_orgs::OrgService;

#[derive(Debug, Serialize)]
struct JwtClaims {
    iat: i64,
    exp: i64,
    iss: String,
}

#[derive(Debug, Deserialize)]
struct GitHubInstallation {
    id: i64,
    account: GitHubAccount,
}

#[derive(Debug, Deserialize)]
struct GitHubAccount {
    login: String,
    #[serde(rename = "type")]
    account_type: String,
}

#[derive(Debug, Deserialize)]
struct GitHubInstallationToken {
    token: String,
}

#[derive(Debug, Deserialize)]
struct GitHubReposResponse {
    repositories: Vec<GitHubApiRepo>,
}

#[derive(Debug, Deserialize)]
struct GitHubApiRepo {
    id: i64,
    full_name: String,
    name: String,
    private: bool,
    default_branch: String,
    html_url: String,
    updated_at: String,
}

pub struct GitHubService {
    store: Arc<RocksStore>,
    org_service: Arc<OrgService>,
    http: reqwest::Client,
}

impl GitHubService {
    pub fn new(store: Arc<RocksStore>, org_service: Arc<OrgService>) -> Self {
        Self {
            store,
            org_service,
            http: reqwest::Client::new(),
        }
    }

    fn load_app_config(&self) -> Result<(String, String, String), GitHubError> {
        let app_id = self
            .get_setting_string("github_app_id")
            .or_else(|_| {
                std::env::var("GITHUB_APP_ID")
                    .map_err(|_| GitHubError::NotConfigured("github_app_id not set".into()))
            })?;

        let private_key = self
            .get_setting_string("github_app_private_key")
            .or_else(|_| {
                std::env::var("GITHUB_APP_PRIVATE_KEY").map_err(|_| {
                    GitHubError::NotConfigured("github_app_private_key not set".into())
                })
            })?;

        let app_slug = self
            .get_setting_string("github_app_slug")
            .or_else(|_| {
                std::env::var("GITHUB_APP_SLUG")
                    .map_err(|_| GitHubError::NotConfigured("github_app_slug not set".into()))
            })?;

        Ok((app_id, private_key, app_slug))
    }

    fn get_setting_string(&self, key: &str) -> Result<String, GitHubError> {
        let bytes = self.store.get_setting(key)?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    fn generate_app_jwt(
        &self,
        app_id: &str,
        private_key_pem: &str,
    ) -> Result<String, GitHubError> {
        let now = Utc::now();
        let claims = JwtClaims {
            iat: (now - Duration::seconds(60)).timestamp(),
            exp: (now + Duration::minutes(9)).timestamp(),
            iss: app_id.to_string(),
        };

        let key = EncodingKey::from_rsa_pem(private_key_pem.as_bytes())?;
        let header = Header::new(Algorithm::RS256);
        Ok(encode(&header, &claims, &key)?)
    }

    async fn get_installation_token(
        &self,
        installation_id: i64,
        app_jwt: &str,
    ) -> Result<String, GitHubError> {
        let resp = self
            .http
            .post(format!(
                "https://api.github.com/app/installations/{installation_id}/access_tokens"
            ))
            .header("Authorization", format!("Bearer {app_jwt}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "aura-app")
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let message = resp.text().await.unwrap_or_default();
            return Err(GitHubError::Api { status, message });
        }

        let token_resp: GitHubInstallationToken = resp.json().await?;
        Ok(token_resp.token)
    }

    pub fn generate_install_url(&self, org_id: &OrgId) -> Result<String, GitHubError> {
        let (_, _, app_slug) = self.load_app_config()?;
        let state = org_id.to_string();
        Ok(format!(
            "https://github.com/apps/{app_slug}/installations/new?state={state}"
        ))
    }

    pub async fn handle_installation_callback(
        &self,
        installation_id: i64,
        org_id: &OrgId,
        connected_by: &str,
    ) -> Result<GitHubIntegration, GitHubError> {
        let (app_id, private_key, _) = self.load_app_config()?;
        let app_jwt = self.generate_app_jwt(&app_id, &private_key)?;

        let resp = self
            .http
            .get(format!(
                "https://api.github.com/app/installations/{installation_id}"
            ))
            .header("Authorization", format!("Bearer {app_jwt}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "aura-app")
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let message = resp.text().await.unwrap_or_default();
            return Err(GitHubError::Api { status, message });
        }

        let installation: GitHubInstallation = resp.json().await?;

        let integration = GitHubIntegration {
            integration_id: GitHubIntegrationId::new(),
            org_id: *org_id,
            installation_id: installation.id,
            github_account_login: installation.account.login,
            github_account_type: installation.account.account_type,
            connected_by: connected_by.to_string(),
            connected_at: Utc::now(),
        };

        self.store.put_github_integration(&integration)?;

        info!(
            integration_id = %integration.integration_id,
            account = %integration.github_account_login,
            "GitHub App installed"
        );

        let install_token = self
            .get_installation_token(installation_id, &app_jwt)
            .await?;
        self.fetch_and_store_repos(&integration, &install_token)
            .await?;

        Ok(integration)
    }

    async fn fetch_and_store_repos(
        &self,
        integration: &GitHubIntegration,
        install_token: &str,
    ) -> Result<Vec<GitHubRepo>, GitHubError> {
        let mut all_repos = Vec::new();
        let mut page = 1u32;

        loop {
            let resp = self
                .http
                .get("https://api.github.com/installation/repositories")
                .query(&[("per_page", "100"), ("page", &page.to_string())])
                .header("Authorization", format!("token {install_token}"))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "aura-app")
                .send()
                .await?;

            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let message = resp.text().await.unwrap_or_default();
                return Err(GitHubError::Api { status, message });
            }

            let body: GitHubReposResponse = resp.json().await?;
            if body.repositories.is_empty() {
                break;
            }

            for api_repo in &body.repositories {
                let repo = GitHubRepo {
                    github_repo_id: api_repo.id,
                    integration_id: integration.integration_id,
                    full_name: api_repo.full_name.clone(),
                    name: api_repo.name.clone(),
                    private: api_repo.private,
                    default_branch: api_repo.default_branch.clone(),
                    html_url: api_repo.html_url.clone(),
                    updated_at: api_repo
                        .updated_at
                        .parse()
                        .unwrap_or_else(|_| Utc::now()),
                };
                self.store.put_github_repo(&repo)?;
                all_repos.push(repo);
            }

            if body.repositories.len() < 100 {
                break;
            }
            page += 1;
        }

        info!(
            integration_id = %integration.integration_id,
            repo_count = all_repos.len(),
            "Fetched GitHub repos"
        );

        Ok(all_repos)
    }

    pub fn list_integrations(
        &self,
        org_id: &OrgId,
    ) -> Result<Vec<GitHubIntegration>, GitHubError> {
        Ok(self.store.list_github_integrations(org_id)?)
    }

    pub fn list_repos_for_org(&self, org_id: &OrgId) -> Result<Vec<GitHubRepo>, GitHubError> {
        Ok(self.store.list_all_github_repos_for_org(org_id)?)
    }

    pub fn list_repos_for_integration(
        &self,
        integration_id: &GitHubIntegrationId,
    ) -> Result<Vec<GitHubRepo>, GitHubError> {
        Ok(self.store.list_github_repos(integration_id)?)
    }

    pub async fn refresh_integration(
        &self,
        org_id: &OrgId,
        integration_id: &GitHubIntegrationId,
    ) -> Result<Vec<GitHubRepo>, GitHubError> {
        let integration = self
            .store
            .get_github_integration(org_id, integration_id)
            .map_err(|_| GitHubError::IntegrationNotFound)?;

        let (app_id, private_key, _) = self.load_app_config()?;
        let app_jwt = self.generate_app_jwt(&app_id, &private_key)?;
        let install_token = self
            .get_installation_token(integration.installation_id, &app_jwt)
            .await?;

        self.store
            .delete_github_repos_by_integration(integration_id)?;

        self.fetch_and_store_repos(&integration, &install_token)
            .await
    }

    pub fn disconnect_integration(
        &self,
        org_id: &OrgId,
        actor_user_id: &str,
        integration_id: &GitHubIntegrationId,
    ) -> Result<(), GitHubError> {
        self.org_service
            .require_admin_or_owner_pub(org_id, actor_user_id)?;

        self.store
            .get_github_integration(org_id, integration_id)
            .map_err(|_| GitHubError::IntegrationNotFound)?;

        self.store
            .delete_github_repos_by_integration(integration_id)?;
        self.store
            .delete_github_integration(org_id, integration_id)?;

        info!(
            integration_id = %integration_id,
            "GitHub integration disconnected"
        );

        Ok(())
    }
}
