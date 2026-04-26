//! Runtime configuration for [`super::CdpBackend`] plus environment-driven
//! discovery helpers.

use std::env;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How long to wait after the last session exits before shutting Chromium
/// down. A short grace period avoids restart churn when the user spawns a
/// new session right after closing the last one.
pub(super) const CHROMIUM_IDLE_GRACE: Duration = Duration::from_secs(15);

/// Runtime configuration for [`super::CdpBackend`].
///
/// Defaults are sensible: sandbox enabled everywhere the kernel supports
/// it, no proxy, no persistent profile. Override from environment at
/// startup with [`Self::from_env`].
#[derive(Debug, Clone, Default)]
pub struct CdpBackendConfig {
    /// Path to a Chromium/Chrome binary. When `None` chromiumoxide tries
    /// to auto-discover one.
    pub executable_path: Option<PathBuf>,
    /// Persistent profile/user-data directory. When `None` each launch
    /// gets a fresh temp directory.
    pub user_data_dir: Option<PathBuf>,
    /// Outgoing proxy server, e.g. `http://proxy.local:3128`.
    pub proxy_server: Option<String>,
    /// Pass `--no-sandbox` to Chromium. Needed in most container images
    /// but disabled by default so local dev uses the safer sandbox.
    pub disable_sandbox: bool,
    /// How long after the last session exits to wait before shutting
    /// Chromium down. `None` keeps it alive forever (legacy behaviour).
    pub idle_shutdown: Option<Duration>,
}

impl CdpBackendConfig {
    /// Pull configuration from environment variables.
    ///
    /// Recognised keys:
    /// - `BROWSER_EXECUTABLE_PATH` — path to Chromium/Chrome.
    /// - `BROWSER_USER_DATA_DIR` — persistent profile directory.
    /// - `BROWSER_PROXY_SERVER` — proxy server URL.
    /// - `BROWSER_DISABLE_SANDBOX` — `1`/`true` to pass `--no-sandbox`.
    pub fn from_env() -> Self {
        let executable_path = env::var_os("BROWSER_EXECUTABLE_PATH")
            .map(PathBuf::from)
            .or_else(discover_default_browser_executable);
        let user_data_dir = env::var_os("BROWSER_USER_DATA_DIR").map(PathBuf::from);
        let proxy_server = env::var("BROWSER_PROXY_SERVER").ok();
        let disable_sandbox = env::var("BROWSER_DISABLE_SANDBOX")
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"))
            .unwrap_or(false);
        Self {
            executable_path,
            user_data_dir,
            proxy_server,
            disable_sandbox,
            idle_shutdown: Some(CHROMIUM_IDLE_GRACE),
        }
    }
}

pub(super) fn discover_default_browser_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let roots = [
            env::var_os("ProgramFiles").map(PathBuf::from),
            env::var_os("ProgramFiles(x86)").map(PathBuf::from),
            env::var_os("LocalAppData").map(PathBuf::from),
        ];
        let suffixes: &[&[&str]] = &[
            &["Google", "Chrome", "Application", "chrome.exe"],
            &["Chromium", "Application", "chrome.exe"],
            &["Microsoft", "Edge", "Application", "msedge.exe"],
        ];

        for root in roots.into_iter().flatten() {
            for suffix in suffixes {
                let candidate = suffix
                    .iter()
                    .fold(root.clone(), |path: PathBuf, part| path.join(part));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

pub(super) fn default_profile_dir() -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    env::temp_dir().join(format!(
        "aura-browser-profile-{}-{millis}",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{LazyLock, Mutex};

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn config_from_env_respects_booleans() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("BROWSER_DISABLE_SANDBOX", "1");
        let cfg = CdpBackendConfig::from_env();
        assert!(cfg.disable_sandbox);
        std::env::set_var("BROWSER_DISABLE_SANDBOX", "no");
        let cfg = CdpBackendConfig::from_env();
        assert!(!cfg.disable_sandbox);
        std::env::remove_var("BROWSER_DISABLE_SANDBOX");
    }

    #[test]
    fn config_from_env_default_is_safe() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        env::remove_var("BROWSER_DISABLE_SANDBOX");
        env::remove_var("BROWSER_EXECUTABLE_PATH");
        env::remove_var("BROWSER_USER_DATA_DIR");
        env::remove_var("BROWSER_PROXY_SERVER");
        let cfg = CdpBackendConfig::from_env();
        assert!(!cfg.disable_sandbox);
        assert_eq!(cfg.executable_path, discover_default_browser_executable());
        assert!(cfg.user_data_dir.is_none());
        assert!(cfg.proxy_server.is_none());
        assert_eq!(cfg.idle_shutdown, Some(CHROMIUM_IDLE_GRACE));
    }

    #[test]
    fn config_from_env_prefers_explicit_executable_path() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let explicit = std::env::temp_dir().join("aura-browser-explicit.exe");
        env::set_var("BROWSER_EXECUTABLE_PATH", &explicit);
        let cfg = CdpBackendConfig::from_env();
        assert_eq!(cfg.executable_path, Some(explicit));
        env::remove_var("BROWSER_EXECUTABLE_PATH");
    }
}
