use std::sync::Arc;

use chrono::Utc;
use tracing::{debug, warn};

use aura_core::ZeroAuthSession;
use aura_store::RocksStore;

use crate::error::AuthError;

const AUTH_SESSION_KEY: &str = "zero_auth_session";
const ZOS_API_DEFAULT_BASE: &str = "https://api.zero.tech";

#[derive(Debug, serde::Deserialize)]
struct ZosLoginResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[allow(dead_code)]
    #[serde(rename = "identityToken")]
    identity_token: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ZosWallet {
    address: String,
}

#[derive(Debug, serde::Deserialize)]
struct ZosUserResponse {
    id: String,
    #[serde(rename = "profileSummary")]
    profile_summary: ZosProfileSummary,
    #[serde(rename = "primaryZID")]
    primary_zid: Option<String>,
    wallets: Option<Vec<ZosWallet>>,
}

#[derive(Debug, serde::Deserialize)]
struct ZosProfileSummary {
    #[serde(rename = "firstName")]
    first_name: String,
    #[serde(rename = "lastName")]
    last_name: String,
    #[serde(rename = "profileImage")]
    profile_image: Option<String>,
}

pub struct AuthService {
    store: Arc<RocksStore>,
    http: reqwest::Client,
    zos_base_url: String,
}

impl AuthService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self {
            store,
            http: reqwest::Client::new(),
            zos_base_url: ZOS_API_DEFAULT_BASE.to_string(),
        }
    }

    pub fn with_base_url(store: Arc<RocksStore>, base_url: String) -> Self {
        Self {
            store,
            http: reqwest::Client::new(),
            zos_base_url: base_url,
        }
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<ZeroAuthSession, AuthError> {
        let login_url = format!("{}/api/v2/accounts/login", self.zos_base_url);

        let login_resp = self
            .http
            .post(&login_url)
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await?;

        if !login_resp.status().is_success() {
            let status = login_resp.status().as_u16();
            let body = login_resp.text().await.unwrap_or_default();
            if status == 401 {
                return Err(AuthError::InvalidCredentials);
            }
            return Err(AuthError::ZosApi {
                status,
                message: body,
            });
        }

        let login_data: ZosLoginResponse = login_resp.json().await?;
        debug!("zOS login successful, fetching user profile");

        let session = self.fetch_and_store_session(&login_data.access_token).await?;
        Ok(session)
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
    ) -> Result<ZeroAuthSession, AuthError> {
        let register_url = format!(
            "{}/api/v2/accounts/createAndAuthorize",
            self.zos_base_url
        );

        let register_resp = self
            .http
            .post(&register_url)
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await?;

        if !register_resp.status().is_success() {
            let status = register_resp.status().as_u16();
            let body = register_resp.text().await.unwrap_or_default();
            return Err(AuthError::RegistrationFailed(format!(
                "status {status}: {body}"
            )));
        }

        let login_data: ZosLoginResponse = register_resp.json().await?;
        debug!("zOS registration successful, fetching user profile");

        let session = self.fetch_and_store_session(&login_data.access_token).await?;
        Ok(session)
    }

    pub async fn get_session(&self) -> Result<ZeroAuthSession, AuthError> {
        let bytes = self
            .store
            .get_setting(AUTH_SESSION_KEY)
            .map_err(|_| AuthError::NoSession)?;

        let session: ZeroAuthSession =
            serde_json::from_slice(&bytes).map_err(AuthError::Serialization)?;

        Ok(session)
    }

    pub async fn validate(&self) -> Result<ZeroAuthSession, AuthError> {
        let mut session = self.get_session().await?;

        let user_url = format!("{}/api/users/current", self.zos_base_url);
        let resp = self
            .http
            .get(&user_url)
            .bearer_auth(&session.access_token)
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            warn!("stored auth token is no longer valid");
            let _ = self.store.delete_setting(AUTH_SESSION_KEY);
            return Err(AuthError::SessionExpired);
        }

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AuthError::ZosApi {
                status,
                message: body,
            });
        }

        session.validated_at = Utc::now();
        let serialized = serde_json::to_vec(&session)?;
        self.store
            .put_setting(AUTH_SESSION_KEY, &serialized)
            .map_err(AuthError::Store)?;

        Ok(session)
    }

    pub async fn logout(&self) -> Result<(), AuthError> {
        if let Ok(session) = self.get_session().await {
            let logout_url = format!("{}/authentication/session", self.zos_base_url);
            let resp = self
                .http
                .delete(&logout_url)
                .bearer_auth(&session.access_token)
                .send()
                .await;

            if let Err(e) = resp {
                warn!(%e, "failed to call zOS logout endpoint");
            }
        }

        let _ = self.store.delete_setting(AUTH_SESSION_KEY);
        debug!("auth session cleared");
        Ok(())
    }

    async fn fetch_and_store_session(
        &self,
        access_token: &str,
    ) -> Result<ZeroAuthSession, AuthError> {
        let user_url = format!("{}/api/users/current", self.zos_base_url);
        let user_resp = self
            .http
            .get(&user_url)
            .bearer_auth(access_token)
            .send()
            .await?;

        if !user_resp.status().is_success() {
            let status = user_resp.status().as_u16();
            let body = user_resp.text().await.unwrap_or_default();
            return Err(AuthError::ZosApi {
                status,
                message: body,
            });
        }

        let user: ZosUserResponse = user_resp.json().await?;

        let display_name = format!(
            "{} {}",
            user.profile_summary.first_name, user.profile_summary.last_name
        )
        .trim()
        .to_string();

        let wallets: Vec<String> = user
            .wallets
            .unwrap_or_default()
            .into_iter()
            .map(|w| w.address)
            .collect();

        let now = Utc::now();
        let session = ZeroAuthSession {
            user_id: user.id,
            display_name,
            profile_image: user
                .profile_summary
                .profile_image
                .unwrap_or_default(),
            primary_zid: user.primary_zid.unwrap_or_default(),
            zero_wallet: wallets.first().cloned().unwrap_or_default(),
            wallets,
            access_token: access_token.to_string(),
            created_at: now,
            validated_at: now,
        };

        let serialized = serde_json::to_vec(&session)?;
        self.store
            .put_setting(AUTH_SESSION_KEY, &serialized)
            .map_err(AuthError::Store)?;

        debug!(user_id = %session.user_id, "auth session stored");
        Ok(session)
    }
}
