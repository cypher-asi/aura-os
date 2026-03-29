mod error;
pub use error::AuthError;

use std::time::Duration;

use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use tracing::{debug, error, warn};

use aura_os_core::ZeroAuthSession;

const ZOS_API_URL: &str = "https://zosapi.zero.tech";

#[derive(Debug, Deserialize)]
struct ZosErrorBody {
    code: Option<String>,
    message: Option<String>,
}

fn parse_zos_error(status: u16, body: &str) -> AuthError {
    let (code, message) = match serde_json::from_str::<ZosErrorBody>(body) {
        Ok(parsed) => (
            parsed.code.unwrap_or_default(),
            parsed.message.unwrap_or_else(|| body.to_string()),
        ),
        Err(_) => (String::new(), body.to_string()),
    };
    error!(status, %code, %message, "zOS API error");
    AuthError::ZosApi {
        status,
        code,
        message,
    }
}

#[derive(Debug, Deserialize)]
struct ZosLoginResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    // Stored for future token refresh support
    #[allow(dead_code)]
    #[serde(rename = "identityToken")]
    identity_token: String,
}

#[derive(Debug, Deserialize)]
struct ZosProfileSummary {
    #[serde(rename = "firstName")]
    first_name: Option<String>,
    #[serde(rename = "lastName")]
    last_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ZosWallet {
    #[serde(rename = "publicAddress")]
    public_address: String,
}

#[derive(Debug, Deserialize)]
struct ZosUserResponse {
    id: String,
    #[serde(rename = "profileSummary")]
    profile_summary: Option<ZosProfileSummary>,
    #[serde(rename = "primaryZID")]
    primary_zid: Option<String>,
    #[serde(rename = "primaryWalletAddress")]
    primary_wallet_address: Option<String>,
    wallets: Option<Vec<ZosWallet>>,
}

#[derive(Debug, Deserialize)]
struct ZosProfileResponse {
    #[serde(rename = "isZeroProSubscriber", default)]
    is_zero_pro: bool,
}

pub struct AuthSessionResult {
    pub session: ZeroAuthSession,
    pub zero_pro_refresh_error: Option<String>,
}

fn zero_pro_refresh_error_message() -> String {
    "Unable to verify ZERO Pro status right now.".to_string()
}

pub struct AuthService {
    http: Client,
}

impl AuthService {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build auth http client"),
        }
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<AuthSessionResult, AuthError> {
        debug!("Logging in via zOS-api");
        let res = self
            .http
            .post(format!("{ZOS_API_URL}/api/v2/accounts/login"))
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        let login_data: ZosLoginResponse = res.json().await.map_err(AuthError::Http)?;
        self.build_session_from_token(&login_data.access_token).await
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
    ) -> Result<AuthSessionResult, AuthError> {
        debug!("Registering via zOS-api");
        let res = self
            .http
            .post(format!("{ZOS_API_URL}/api/v2/accounts/createAndAuthorize"))
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        let login_data: ZosLoginResponse = res.json().await.map_err(AuthError::Http)?;
        self.build_session_from_token(&login_data.access_token).await
    }

    pub async fn import_access_token(
        &self,
        access_token: &str,
    ) -> Result<AuthSessionResult, AuthError> {
        debug!("Importing existing zOS access token");
        let result = self.build_session_from_token(access_token).await?;
        // Store to RocksDB for the network bridge and desktop session persistence
        let bytes = serde_json::to_vec(&result.session)?;
        self.store.put_setting(AUTH_SESSION_KEY, &bytes)?;
        Ok(result)
    }

    pub async fn logout(&self, token: Option<&str>) -> Result<(), AuthError> {
        if let Some(jwt) = token {
            debug!("Logging out via zOS-api");
            let _ = self
                .http
                .delete(format!("{ZOS_API_URL}/authentication/session"))
                .bearer_auth(jwt)
                .send()
                .await;
        }
        Ok(())
    }

    async fn fetch_user_info(&self, token: &str) -> Result<ZosUserResponse, AuthError> {
        let res = self
            .http
            .get(format!("{ZOS_API_URL}/api/users/current"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        res.json().await.map_err(AuthError::Http)
    }

    async fn fetch_is_zero_pro(&self, token: &str) -> Result<bool, AuthError> {
        let res = self
            .http
            .get(format!("{ZOS_API_URL}/api/v2/users/me"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(AuthError::Http)?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            return Err(parse_zos_error(status, &body));
        }

        res.json::<ZosProfileResponse>()
            .await
            .map(|p| p.is_zero_pro)
            .map_err(AuthError::Http)
    }

    /// Validate a JWT token against zOS without reading from or writing to RocksDB.
    /// Returns a fresh session built from the zOS user info and Pro status.
    /// `network_user_id` and `profile_id` will be `None` — populated later
    /// by `sync_user_to_network` on the server side.
    pub async fn validate_token(&self, token: &str) -> Result<AuthSessionResult, AuthError> {
        debug!("Validating token against zOS-api");
        self.build_session_from_token(token).await
    }

    /// Build a `ZeroAuthSession` from a token by fetching user info and Pro status from zOS.
    async fn build_session_from_token(
        &self,
        access_token: &str,
    ) -> Result<AuthSessionResult, AuthError> {
        let user = self.fetch_user_info(access_token).await?;
        let now = Utc::now();
        let mut session = ZeroAuthSession {
            user_id: user.id,
            network_user_id: None,
            profile_id: None,
            display_name: build_display_name(&user.profile_summary, &user.primary_zid),
            profile_image: String::new(),
            primary_zid: user.primary_zid.unwrap_or_default(),
            zero_wallet: user.primary_wallet_address.unwrap_or_default(),
            wallets: user
                .wallets
                .unwrap_or_default()
                .into_iter()
                .map(|w| w.public_address)
                .collect(),
            access_token: access_token.to_string(),
            is_zero_pro: false,
            created_at: now,
            validated_at: now,
        };
        let mut zero_pro_refresh_error = None;

        match self.fetch_is_zero_pro(access_token).await {
            Ok(is_zero_pro) => {
                session.is_zero_pro = is_zero_pro;
            }
            Err(err) => {
                zero_pro_refresh_error = Some(zero_pro_refresh_error_message());
                warn!(
                    error = %err,
                    user_id = %session.user_id,
                    "authenticated session but could not verify ZERO Pro entitlement"
                );
            }
        }

        Ok(AuthSessionResult {
            session,
            zero_pro_refresh_error,
        })
    }

}

fn build_display_name(profile: &Option<ZosProfileSummary>, primary_zid: &Option<String>) -> String {
    if let Some(p) = profile {
        let first = p.first_name.as_deref().unwrap_or("");
        let last = p.last_name.as_deref().unwrap_or("");
        let full = format!("{first} {last}").trim().to_string();
        if !full.is_empty() {
            return full;
        }
    }
    if let Some(zid) = primary_zid {
        if !zid.is_empty() {
            return zid.clone();
        }
    }
    "User".to_string()
}
