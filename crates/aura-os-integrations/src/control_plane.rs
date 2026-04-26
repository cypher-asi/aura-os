//! Control-plane base URL resolution.
//!
//! Helpers that derive the base URL the aura-os-server should advertise
//! for self-callbacks. Both the desktop binary's local-harness sidecar
//! and the off-box swarm harness call back into the server via this
//! URL, so it must point at a host that is actually routable from the
//! harness's perspective.

/// Base URL the aura-os-server advertises for self-callbacks.
///
/// Used to stamp server-contributed tool endpoints so the
/// harness — which executes `InstalledTool` calls from a separate process
/// or host (e.g. `aura-swarm` on Render) — can reach the server at a
/// publicly routable URL rather than loopback.
///
/// Reads `AURA_SERVER_BASE_URL` first, then falls back to `VITE_API_URL`
/// (which Render deployments already set so the Vite build can bake it
/// into the frontend bundle — reusing it here avoids requiring operators
/// to duplicate the same value under two different names). This is the
/// single source of truth shared with
/// [`apps/aura-os-server/src/app_builder.rs`](../../../apps/aura-os-server/src/app_builder.rs),
/// where it also feeds `AgentRuntimeService.local_server_base_url` used
/// by the `send_to_agent` tool. Any deployment where the harness runs
/// on a different host MUST set one of these env vars to the server's
/// public URL — otherwise cross-agent tool callbacks fail with
/// `external tool callback unreachable: http://127.0.0.1:...`.
///
/// Falls back to `http://<AURA_SERVER_HOST>:<AURA_SERVER_PORT>` for
/// local-dev where the server and harness share a loopback interface.
pub fn control_plane_api_base_url() -> String {
    if let Some(url) = explicit_control_plane_base_url() {
        return url;
    }

    let (_, fallback_url) = control_plane_api_base_url_fallback();
    fallback_url
}

/// Error surfaced by [`control_plane_api_base_url_or_error`] when the
/// derived fallback would stamp a loopback URL onto a manifest bound
/// for a remote harness.
///
/// Carries the fallback URL the caller was about to ship so the
/// operator-facing error message can name the offending value — the
/// prod failure mode is the CEO agent POSTing `http://127.0.0.1:3100`
/// from a swarm pod that has no loopback route to the control plane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlPlaneBaseUrlError {
    /// Neither `AURA_SERVER_BASE_URL` nor `VITE_API_URL` is set and the
    /// derived fallback points at loopback, which a remote harness
    /// cannot reach. Carries the fallback URL the caller was about to
    /// ship so the error message can name the offending value.
    MissingForRemoteHarness { fallback_url: String },
}

impl std::fmt::Display for ControlPlaneBaseUrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ControlPlaneBaseUrlError::MissingForRemoteHarness { fallback_url } => write!(
                f,
                "AURA_SERVER_BASE_URL (or VITE_API_URL) must be set when the harness runs off-box; \
                 refusing to ship `{fallback_url}` to the harness"
            ),
        }
    }
}

impl std::error::Error for ControlPlaneBaseUrlError {}

/// Fallible variant of [`control_plane_api_base_url`].
///
/// When `remote_harness` is `true` and neither `AURA_SERVER_BASE_URL`
/// nor `VITE_API_URL` is set AND the derived fallback host is loopback,
/// returns [`ControlPlaneBaseUrlError::MissingForRemoteHarness`] so the
/// caller can fail fast instead of silently shipping
/// `http://127.0.0.1:<port>` to a harness running in a different pod
/// / container / host (which manifests as
/// `tcp connect error: ... os error 10061` on every cross-agent tool
/// call the swarm harness tries to dispatch back to the control plane).
///
/// Callers that legitimately want the loopback default (the desktop
/// `cargo run -p aura-os-desktop` path, in-process tests) keep
/// calling the infallible [`control_plane_api_base_url`] helper, which
/// is explicitly unchanged.
pub fn control_plane_api_base_url_or_error(
    remote_harness: bool,
) -> Result<String, ControlPlaneBaseUrlError> {
    if let Some(url) = explicit_control_plane_base_url() {
        return Ok(url);
    }

    let (host, fallback_url) = control_plane_api_base_url_fallback();
    if remote_harness && is_loopback_host(&host) {
        return Err(ControlPlaneBaseUrlError::MissingForRemoteHarness { fallback_url });
    }
    Ok(fallback_url)
}

/// Trim + normalise the explicit control-plane base URL override, if
/// any. Reads `AURA_SERVER_BASE_URL` first (higher priority so existing
/// deployments that set it keep winning), then falls back to
/// `VITE_API_URL` — the same var the Vite build already consumes, so a
/// single Render env var is sufficient to configure both the frontend
/// bundle and the server's self-callback URL. Kept private so both
/// entry points apply identical trimming rules (trailing slash +
/// whitespace) to the explicit value.
fn explicit_control_plane_base_url() -> Option<String> {
    read_trimmed_base_url_env("AURA_SERVER_BASE_URL")
        .or_else(|| read_trimmed_base_url_env("VITE_API_URL"))
}

fn read_trimmed_base_url_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

/// Build the `http://<host>:<port>` fallback used when
/// `AURA_SERVER_BASE_URL` is unset. Returns the normalised host
/// alongside the URL so the fallible variant can classify it without
/// re-parsing the URL.
fn control_plane_api_base_url_fallback() -> (String, String) {
    let port = std::env::var("AURA_SERVER_PORT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "3100".to_string());
    let host = std::env::var("AURA_SERVER_HOST")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let normalized_host = match host.as_str() {
        "0.0.0.0" | "::" => "127.0.0.1".to_string(),
        other if other.contains(':') && !other.starts_with('[') => format!("[{other}]"),
        other => other.to_string(),
    };

    let url = format!("http://{normalized_host}:{port}");
    (normalized_host, url)
}

/// Classify a host string as loopback. Matches the canonical set the
/// fallback helper can emit (`127.0.0.1`, `::1`, `[::1]`) plus the
/// literal `localhost` since operators do set `AURA_SERVER_HOST=localhost`
/// in some local-dev configs. Case-insensitive on the textual form.
fn is_loopback_host(host: &str) -> bool {
    let trimmed = host.trim();
    let normalized = trimmed.trim_start_matches('[').trim_end_matches(']');
    matches!(normalized, "127.0.0.1" | "::1") || normalized.eq_ignore_ascii_case("localhost")
}

// ------------------------------------------------------------------
// control_plane_api_base_url()
// ------------------------------------------------------------------
//
// These tests mutate process-wide env vars, so they take a shared
// mutex and must snapshot/restore every variable they touch.
// `AURA_SERVER_BASE_URL` and `VITE_API_URL` are both read by
// `app_builder.rs` at server startup; leaking a stale value from
// a test into another test (or the wider suite) would poison
// unrelated runs.
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static CONTROL_PLANE_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, prev }
        }

        fn unset(key: &'static str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn control_plane_uses_aura_server_base_url_when_set() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::set("AURA_SERVER_BASE_URL", "https://aura.example.com");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "https://aura.example.com");
    }

    #[test]
    fn control_plane_trims_trailing_slash_from_base_url() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::set("AURA_SERVER_BASE_URL", "https://aura.example.com/");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "https://aura.example.com");
    }

    #[test]
    fn control_plane_falls_back_to_host_and_port_when_base_url_missing() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::set("AURA_SERVER_HOST", "10.0.0.5");
        let _port = EnvGuard::set("AURA_SERVER_PORT", "9000");

        assert_eq!(control_plane_api_base_url(), "http://10.0.0.5:9000");
    }

    #[test]
    fn control_plane_fallback_normalizes_wildcard_host_to_loopback() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::set("AURA_SERVER_HOST", "0.0.0.0");
        let _port = EnvGuard::set("AURA_SERVER_PORT", "3100");

        assert_eq!(control_plane_api_base_url(), "http://127.0.0.1:3100");
    }

    #[test]
    fn control_plane_uses_default_port_when_unset() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "http://127.0.0.1:3100");
    }

    #[test]
    fn control_plane_ignores_empty_base_url() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::set("AURA_SERVER_BASE_URL", "   ");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "http://127.0.0.1:3100");
    }

    #[test]
    fn control_plane_uses_vite_api_url_when_base_url_unset() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::set("VITE_API_URL", " https://aura.example.com/ ");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "https://aura.example.com");
    }

    #[test]
    fn control_plane_prefers_aura_server_base_url_over_vite_api_url() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::set("AURA_SERVER_BASE_URL", "https://aura.example.com");
        let _vite = EnvGuard::set("VITE_API_URL", "https://vite.example.com");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "https://aura.example.com");
    }

    #[test]
    fn control_plane_ignores_empty_vite_api_url() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::set("VITE_API_URL", "   ");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(control_plane_api_base_url(), "http://127.0.0.1:3100");
    }

    #[test]
    fn control_plane_api_base_url_or_error_returns_ok_when_base_url_set() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::set("AURA_SERVER_BASE_URL", "https://aura.example.com");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(
            control_plane_api_base_url_or_error(true).unwrap(),
            "https://aura.example.com"
        );
    }

    #[test]
    fn control_plane_api_base_url_or_error_returns_ok_when_vite_api_url_set() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::set("VITE_API_URL", "https://aura.example.com");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(
            control_plane_api_base_url_or_error(true).unwrap(),
            "https://aura.example.com"
        );
    }

    #[test]
    fn control_plane_api_base_url_or_error_returns_ok_for_local_harness_fallback() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(
            control_plane_api_base_url_or_error(false).unwrap(),
            "http://127.0.0.1:3100"
        );
    }

    #[test]
    fn control_plane_api_base_url_or_error_errors_when_fallback_is_loopback_and_remote() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::unset("AURA_SERVER_HOST");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        let err = control_plane_api_base_url_or_error(true).unwrap_err();
        assert_eq!(
            err,
            ControlPlaneBaseUrlError::MissingForRemoteHarness {
                fallback_url: "http://127.0.0.1:3100".to_string(),
            }
        );
        let rendered = err.to_string();
        assert!(
            rendered.contains("AURA_SERVER_BASE_URL"),
            "error message must name the env var: {rendered}"
        );
        assert!(
            rendered.contains("VITE_API_URL"),
            "error message must name the VITE_API_URL fallback env var: {rendered}"
        );
        assert!(
            rendered.contains("127.0.0.1:3100"),
            "error message must name the offending fallback URL: {rendered}"
        );
    }

    #[test]
    fn control_plane_api_base_url_or_error_returns_ok_when_host_is_non_loopback() {
        let _lock = CONTROL_PLANE_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::set("AURA_SERVER_HOST", "10.0.0.5");
        let _port = EnvGuard::unset("AURA_SERVER_PORT");

        assert_eq!(
            control_plane_api_base_url_or_error(true).unwrap(),
            "http://10.0.0.5:3100"
        );
    }
}
