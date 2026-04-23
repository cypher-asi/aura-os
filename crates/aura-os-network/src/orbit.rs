use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

#[derive(Debug)]
pub enum OrbitError {
    Request(String),
    Response { status: u16, body: String },
}

impl fmt::Display for OrbitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Request(msg) => write!(f, "orbit request failed: {msg}"),
            Self::Response { status, body } => {
                write!(f, "orbit returned {status}: {body}")
            }
        }
    }
}

impl std::error::Error for OrbitError {}

/// Orbit service discovery payload, returned by `GET /`.
///
/// Live at `https://orbit-sfvu.onrender.com/` today as
/// `{"apiVersion":"1","baseUrl":...,"gitUrlPrefix":...,"auth":"bearer"}`.
/// Only `api_version`, `git_url_prefix`, and `auth` are currently
/// consumed; additional fields are accepted and ignored to stay
/// forward-compatible with orbit rolling out new advertisement keys.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct OrbitDiscovery {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "gitUrlPrefix")]
    pub git_url_prefix: String,
    pub auth: String,
}

/// How long a cached [`OrbitDiscovery`] entry is considered fresh.
/// Orbit's discovery payload is effectively static across deploys, so
/// re-fetching on every call would be pure overhead.
const DISCOVERY_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
struct CachedDiscovery {
    value: Option<OrbitDiscovery>,
    fetched_at: Option<Instant>,
}

#[derive(Clone)]
pub struct OrbitClient {
    http: Client,
    base_url: String,
    /// Shared cache of the `GET /` discovery response.
    ///
    /// Arc<Mutex<_>> so cloning the client keeps all clones pointing at
    /// the same cache (avoids every `orbit_client.clone()` call paying
    /// the first-fetch tax independently).
    discovery_cache: Arc<Mutex<CachedDiscovery>>,
}

impl OrbitClient {
    pub fn from_env() -> Option<Self> {
        let base_url = std::env::var("ORBIT_BASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())?;
        let base_url = base_url.trim_end_matches('/').to_string();
        info!(base_url = %base_url, "Orbit client configured");
        Some(Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("failed to build orbit http client"),
            base_url,
            discovery_cache: Arc::new(Mutex::new(CachedDiscovery::default())),
        })
    }

    /// Liveness probe against `GET /health`.
    ///
    /// Unauthenticated and cheap (~100 bytes response). Treats any 2xx
    /// as healthy and surfaces any other status or transport error as
    /// an [`OrbitError`]. Uses a short 5s total timeout so the caller
    /// (typically a pre-flight guard before a push) can fall through to
    /// "defer" quickly when orbit is wedged instead of inheriting the
    /// 30s default timeout used for mutating requests.
    pub async fn health(&self) -> Result<(), OrbitError> {
        let url = format!("{}/health", self.base_url);
        let resp = self
            .http
            .get(&url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| OrbitError::Request(e.to_string()))?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(OrbitError::Response {
                status: status.as_u16(),
                body,
            })
        }
    }

    /// Fetch `GET /` discovery, memoised for [`DISCOVERY_TTL`].
    ///
    /// Callers must not rely on the returned `base_url` field matching
    /// the configured `ORBIT_BASE_URL`: orbit advertises its own
    /// public URL, which can differ in a deployment where the client
    /// reaches orbit through an internal address.
    pub async fn discovery(&self) -> Result<OrbitDiscovery, OrbitError> {
        {
            let cache = self.discovery_cache.lock().await;
            if let (Some(ref value), Some(ts)) = (&cache.value, cache.fetched_at) {
                if ts.elapsed() < DISCOVERY_TTL {
                    return Ok(value.clone());
                }
            }
        }
        let url = format!("{}/", self.base_url);
        let resp = self
            .http
            .get(&url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| OrbitError::Request(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(OrbitError::Response {
                status: status.as_u16(),
                body,
            });
        }
        let discovery: OrbitDiscovery = resp
            .json()
            .await
            .map_err(|e| OrbitError::Request(format!("invalid discovery payload: {e}")))?;
        let mut cache = self.discovery_cache.lock().await;
        cache.value = Some(discovery.clone());
        cache.fetched_at = Some(Instant::now());
        Ok(discovery)
    }

    /// Ensure a repository exists on Orbit, creating it if necessary.
    ///
    /// Calls `POST /v1/repos` with the user's JWT. Treats 409 (already exists)
    /// as success so the operation is idempotent.
    pub async fn ensure_repo(
        &self,
        name: &str,
        org_id: &str,
        project_id: &str,
        jwt: &str,
    ) -> Result<(), OrbitError> {
        let url = format!("{}/v1/repos", self.base_url);
        debug!(%url, %name, %org_id, %project_id, "Creating Orbit repo");

        let resp = self
            .http
            .post(&url)
            .header("authorization", format!("Bearer {jwt}"))
            .json(&serde_json::json!({
                "name": name,
                "orgId": org_id,
                "projectId": project_id,
            }))
            .send()
            .await
            .map_err(|e| OrbitError::Request(e.to_string()))?;

        let status = resp.status();

        if status.as_u16() == 409 {
            info!(%name, %org_id, "Orbit repo already exists (409)");
            return Ok(());
        }

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!(
                status = status.as_u16(),
                %body, %name, %org_id,
                "Orbit repo creation failed"
            );
            return Err(OrbitError::Response {
                status: status.as_u16(),
                body,
            });
        }

        info!(%name, %org_id, "Orbit repo created");
        Ok(())
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live shape advertised by `https://orbit-sfvu.onrender.com/` as of
    /// this change. Locking the wire contract in a unit test so future
    /// orbit rollouts that rename a field are caught before they land in
    /// a release instead of silently degrading the pre-flight guard to
    /// "always fail".
    #[test]
    fn discovery_parses_live_orbit_shape() {
        let raw = r#"{
            "apiVersion": "1",
            "baseUrl": "https://orbit-sfvu.onrender.com",
            "gitUrlPrefix": "https://orbit-sfvu.onrender.com/",
            "auth": "bearer"
        }"#;
        let parsed: OrbitDiscovery =
            serde_json::from_str(raw).expect("live discovery payload must parse");
        assert_eq!(parsed.api_version, "1");
        assert_eq!(parsed.base_url, "https://orbit-sfvu.onrender.com");
        assert_eq!(parsed.git_url_prefix, "https://orbit-sfvu.onrender.com/");
        assert_eq!(parsed.auth, "bearer");
    }

    /// Orbit may add new top-level fields (e.g. `features`, `quota`) in
    /// future rollouts; the client must accept them and ignore them
    /// rather than failing discovery and forcing the guard into a
    /// conservative "orbit unreachable" fallback.
    #[test]
    fn discovery_ignores_unknown_fields() {
        let raw = r#"{
            "apiVersion": "2",
            "baseUrl": "https://orbit.example.com",
            "gitUrlPrefix": "https://orbit.example.com/",
            "auth": "bearer",
            "features": ["gc", "quota"],
            "limits": { "maxPackSizeBytes": 1048576 }
        }"#;
        let parsed: OrbitDiscovery =
            serde_json::from_str(raw).expect("forward-compatible discovery must parse");
        assert_eq!(parsed.api_version, "2");
        assert_eq!(parsed.auth, "bearer");
    }

    /// Missing fields default to empty strings (via `#[serde(default)]`)
    /// rather than failing deserialization outright, so a partially
    /// degraded orbit build that drops a non-critical field (e.g.
    /// `baseUrl`) still lets the caller observe `api_version` and
    /// `auth` instead of hard-failing the whole pre-flight check.
    #[test]
    fn discovery_defaults_fields_when_missing() {
        let raw = r#"{"apiVersion":"1","auth":"bearer"}"#;
        let parsed: OrbitDiscovery =
            serde_json::from_str(raw).expect("partial discovery must parse");
        assert_eq!(parsed.api_version, "1");
        assert_eq!(parsed.auth, "bearer");
        assert_eq!(parsed.base_url, "");
        assert_eq!(parsed.git_url_prefix, "");
    }
}
