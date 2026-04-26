//! Frontend dev-server configuration: how the desktop binary picks
//! between the bundled axum-served frontend and a live Vite server,
//! including the candidate URL pair we hand the rest of the pipeline.

use std::time::Duration;

use crate::init::env::{ci_mode_enabled, env_flag_enabled, env_string};

pub(crate) const DEFAULT_FRONTEND_BIND_HOST: &str = "127.0.0.1";
pub(crate) const DEFAULT_FRONTEND_PORT: u16 = 5173;

/// How long `main()` will block before creating the main webview waiting for
/// the Vite dev server to become reachable. The goal is to avoid loading the
/// axum-bundled frontend first and then hot-swapping to Vite via
/// `main_webview.load_url` once it comes up — that swap is a full document
/// teardown that the user perceives as "shell → black flash → shell again,
/// then app loads". By polling up front we make sure the very first URL we
/// navigate the webview to is already Vite, so the reveal is single-paint.
///
/// Only applies in debug builds (gated by `should_try_frontend_dev_server`).
/// The fallback reveal timer (`WINDOW_SHOW_FALLBACK_DELAY`) still bounds the
/// worst case if something upstream is much slower than expected, so a high
/// timeout here is safe. Overridable via
/// `AURA_DESKTOP_FRONTEND_DEV_READY_TIMEOUT_MS` (set to `0` to skip the wait).
pub(crate) const FRONTEND_DEV_SERVER_READY_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrontendDevServerCandidate {
    pub(crate) probe_url: String,
    pub(crate) frontend_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrontendTarget {
    pub(crate) url: String,
    pub(crate) host_origin: Option<String>,
    pub(crate) using_frontend_dev_server: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrontendDevServerConfig {
    pub(crate) frontend_url: String,
    pub(crate) bind_host: String,
    pub(crate) port: u16,
    pub(crate) can_spawn_local: bool,
}

impl FrontendTarget {
    pub(crate) fn server(server_url: &str) -> Self {
        Self {
            url: server_url.to_string(),
            host_origin: None,
            using_frontend_dev_server: false,
        }
    }

    pub(crate) fn dev_server(server_url: &str, frontend_url: String) -> Self {
        Self {
            url: frontend_url,
            host_origin: Some(server_url.to_string()),
            using_frontend_dev_server: true,
        }
    }
}

pub(crate) fn build_frontend_dev_server_config(
    frontend_dev_url_override: Option<&str>,
    bind_host_override: Option<&str>,
    connect_host_override: Option<&str>,
    port_override: Option<u16>,
    ci_mode: bool,
) -> FrontendDevServerConfig {
    let bind_host = bind_host_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_FRONTEND_BIND_HOST)
        .to_string();
    let port = port_override.unwrap_or(DEFAULT_FRONTEND_PORT);

    if let Some(frontend_dev_url) = frontend_dev_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return FrontendDevServerConfig {
            frontend_url: frontend_dev_url.to_string(),
            bind_host,
            port,
            can_spawn_local: false,
        };
    }

    let connect_host = connect_host_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(bind_host.as_str());
    let connect_host = if connect_host == "0.0.0.0" {
        DEFAULT_FRONTEND_BIND_HOST
    } else {
        connect_host
    };

    FrontendDevServerConfig {
        frontend_url: format!("http://{connect_host}:{port}"),
        bind_host,
        port,
        can_spawn_local: !ci_mode,
    }
}

pub(crate) fn should_try_frontend_dev_server() -> bool {
    cfg!(debug_assertions) && !env_flag_enabled("AURA_DESKTOP_DISABLE_FRONTEND_DEV_SERVER")
}

pub(crate) fn configured_frontend_dev_server_config() -> Option<FrontendDevServerConfig> {
    if !should_try_frontend_dev_server() {
        return None;
    }

    let frontend_dev_url = env_string("AURA_DESKTOP_FRONTEND_DEV_URL");
    let frontend_bind_host = env_string("AURA_FRONTEND_HOST");
    let frontend_connect_host = env_string("AURA_DESKTOP_FRONTEND_CONNECT_HOST");
    let frontend_port = env_string("AURA_FRONTEND_PORT")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);

    Some(build_frontend_dev_server_config(
        frontend_dev_url.as_deref(),
        frontend_bind_host.as_deref(),
        frontend_connect_host.as_deref(),
        frontend_port,
        ci_mode_enabled(),
    ))
}

pub(crate) fn configured_frontend_dev_server_ready_timeout() -> Duration {
    match env_string("AURA_DESKTOP_FRONTEND_DEV_READY_TIMEOUT_MS")
        .and_then(|value| value.parse::<u64>().ok())
    {
        Some(ms) => Duration::from_millis(ms),
        None => FRONTEND_DEV_SERVER_READY_TIMEOUT,
    }
}

#[cfg(test)]
mod tests {
    use super::build_frontend_dev_server_config;

    #[test]
    fn build_frontend_dev_server_config_uses_local_defaults() {
        let config = build_frontend_dev_server_config(None, None, None, None, false);

        assert_eq!(config.frontend_url, "http://127.0.0.1:5173");
        assert_eq!(config.bind_host, "127.0.0.1");
        assert_eq!(config.port, 5173);
        assert!(config.can_spawn_local);
    }

    #[test]
    fn build_frontend_dev_server_config_normalizes_wildcard_bind_host() {
        let config =
            build_frontend_dev_server_config(None, Some("0.0.0.0"), None, Some(5173), false);

        assert_eq!(config.frontend_url, "http://127.0.0.1:5173");
        assert_eq!(config.bind_host, "0.0.0.0");
        assert!(config.can_spawn_local);
    }

    #[test]
    fn build_frontend_dev_server_config_disables_spawn_for_explicit_url() {
        let config = build_frontend_dev_server_config(
            Some("http://192.168.1.42:5179"),
            Some("127.0.0.1"),
            Some("127.0.0.1"),
            Some(5173),
            false,
        );

        assert_eq!(config.frontend_url, "http://192.168.1.42:5179");
        assert!(!config.can_spawn_local);
    }
}
