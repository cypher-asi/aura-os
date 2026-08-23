//! Runtime configuration for [`super::CdpBackend`] plus environment-driven
//! discovery helpers.

use std::env;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::path::Path;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::BrowserExecutableSource;

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
    /// Source used to resolve `executable_path`, surfaced in diagnostics.
    pub executable_source: BrowserExecutableSource,
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
    /// - `BROWSER_EXECUTABLE_PATH` — path to Edge, Chrome, or Chromium.
    /// - `BROWSER_USER_DATA_DIR` — persistent profile directory.
    /// - `BROWSER_PROXY_SERVER` — proxy server URL.
    /// - `BROWSER_DISABLE_SANDBOX` — `1`/`true` to pass `--no-sandbox`.
    pub fn from_env() -> Self {
        Self::from_env_with_saved_executable(None)
    }

    /// Pull configuration from the environment and automatic discovery,
    /// preferring a path previously selected in AURA's desktop settings.
    pub fn from_env_with_saved_executable(saved_path: Option<PathBuf>) -> Self {
        let (executable_path, executable_source) = resolve_browser_executable(saved_path);
        let user_data_dir = env::var_os("BROWSER_USER_DATA_DIR").map(PathBuf::from);
        let proxy_server = env::var("BROWSER_PROXY_SERVER").ok();
        let disable_sandbox = env::var("BROWSER_DISABLE_SANDBOX")
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"))
            .unwrap_or(false);
        Self {
            executable_path,
            executable_source,
            user_data_dir,
            proxy_server,
            disable_sandbox,
            idle_shutdown: Some(CHROMIUM_IDLE_GRACE),
        }
    }

    pub(super) fn set_runtime_executable(&mut self, path: Option<PathBuf>) {
        let (executable_path, executable_source) = resolve_browser_executable(path);
        self.executable_path = executable_path;
        self.executable_source = executable_source;
    }
}

fn resolve_browser_executable(
    saved_path: Option<PathBuf>,
) -> (Option<PathBuf>, BrowserExecutableSource) {
    if let Some(path) = saved_path {
        return (Some(path), BrowserExecutableSource::SavedSetting);
    }
    if let Some(path) = env::var_os("BROWSER_EXECUTABLE_PATH").map(PathBuf::from) {
        return (Some(path), BrowserExecutableSource::ProcessEnvironment);
    }
    #[cfg(windows)]
    if let Some(path) = persisted_user_browser_executable() {
        return (Some(path), BrowserExecutableSource::UserEnvironment);
    }
    if let Some(path) = discover_default_browser_executable() {
        return (Some(path), BrowserExecutableSource::AutomaticDiscovery);
    }
    (None, BrowserExecutableSource::NotFound)
}

pub(super) fn discover_default_browser_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        discover_registered_browser_executable()
            .or_else(|| discover_browser_in_roots(windows_browser_roots()))
    }
    #[cfg(not(windows))]
    {
        discover_non_windows_browser_executable()
    }
}

#[cfg(not(windows))]
fn discover_non_windows_browser_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME") {
            let applications = PathBuf::from(home).join("Applications");
            candidates.extend(mac_browser_candidates(&applications));
        }
        candidates.extend(mac_browser_candidates(Path::new("/Applications")));
    }
    #[cfg(not(target_os = "macos"))]
    {
        candidates.extend(
            [
                "/usr/bin/microsoft-edge",
                "/usr/bin/microsoft-edge-stable",
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
            ]
            .into_iter()
            .map(PathBuf::from),
        );
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(all(not(windows), target_os = "macos"))]
fn mac_browser_candidates(applications: &Path) -> Vec<PathBuf> {
    [
        ("Microsoft Edge.app", "Microsoft Edge"),
        ("Google Chrome.app", "Google Chrome"),
        ("Chromium.app", "Chromium"),
    ]
    .into_iter()
    .map(|(bundle, executable)| {
        applications
            .join(bundle)
            .join("Contents")
            .join("MacOS")
            .join(executable)
    })
    .collect()
}

/// Relative install paths used by current stable and preview Windows browser
/// channels. Edge comes first because it is present on most managed Windows
/// devices even when organization policy forbids installing Chrome.
#[cfg(any(windows, test))]
const WINDOWS_BROWSER_RELATIVE_PATHS: &[&[&str]] = &[
    &["Microsoft", "Edge", "Application", "msedge.exe"],
    &["Microsoft", "Edge Beta", "Application", "msedge.exe"],
    &["Microsoft", "Edge Dev", "Application", "msedge.exe"],
    &["Microsoft", "Edge SxS", "Application", "msedge.exe"],
    &["Google", "Chrome", "Application", "chrome.exe"],
    &["Chromium", "Application", "chrome.exe"],
];

#[cfg(any(windows, test))]
fn discover_browser_in_roots(roots: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    for root in roots {
        for suffix in WINDOWS_BROWSER_RELATIVE_PATHS {
            let candidate = suffix
                .iter()
                .fold(root.clone(), |path: PathBuf, part| path.join(part));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn windows_browser_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = [
        "ProgramW6432",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "LocalAppData",
    ]
    .into_iter()
    .filter_map(env::var_os)
    .map(PathBuf::from)
    .collect();

    // A packaged 32-bit process can see redirected or incomplete environment
    // variables. Query both registry views' canonical Program Files values.
    roots.extend(windows_program_files_registry_roots());

    // Packaged and managed processes occasionally start without the usual
    // ProgramFiles variables. SystemDrive still lets us cover the default
    // system-level locations without assuming Windows is installed on C:.
    if let Some(system_drive) = env::var_os("SystemDrive") {
        let drive = PathBuf::from(system_drive);
        roots.push(drive.join("Program Files"));
        roots.push(drive.join("Program Files (x86)"));
    }

    if let Some(system_root) = env::var_os("SystemRoot") {
        if let Some(drive_root) = PathBuf::from(system_root).parent() {
            roots.push(drive_root.join("Program Files"));
            roots.push(drive_root.join("Program Files (x86)"));
        }
    }

    // Last-resort defaults cover the overwhelmingly common corporate Windows
    // layout even when a launcher strips all relevant environment variables
    // and registry App Paths are locked down by policy.
    roots.push(PathBuf::from(r"C:\Program Files"));
    roots.push(PathBuf::from(r"C:\Program Files (x86)"));

    let mut unique = Vec::new();
    for root in roots {
        if !unique.contains(&root) {
            unique.push(root);
        }
    }
    unique
}

#[cfg(windows)]
fn windows_program_files_registry_roots() -> Vec<PathBuf> {
    const KEYS: &[&str] = &[
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion",
        "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion",
    ];
    const VALUES: &[&str] = &[
        "ProgramFilesDir",
        "ProgramFilesDir (x86)",
        "ProgramW6432Dir",
    ];
    let mut roots = Vec::new();
    for key_path in KEYS {
        if let Ok(key) = windows_registry::LOCAL_MACHINE.open(key_path) {
            for value in VALUES {
                if let Ok(path) = key.get_string(value) {
                    roots.push(PathBuf::from(path));
                }
            }
        }
    }
    roots
}

#[cfg(windows)]
fn persisted_user_browser_executable() -> Option<PathBuf> {
    windows_registry::CURRENT_USER
        .open("Environment")
        .and_then(|key| key.get_string("BROWSER_EXECUTABLE_PATH"))
        .ok()
        .map(|raw| PathBuf::from(raw.trim().trim_matches('"')))
        .filter(|path| !path.as_os_str().is_empty())
}

#[cfg(windows)]
fn discover_registered_browser_executable() -> Option<PathBuf> {
    const APP_PATHS: &[&str] = &[
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
        "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
        "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chromium.exe",
        "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chromium.exe",
    ];

    for key_path in APP_PATHS {
        let registered = windows_registry::CURRENT_USER
            .open(key_path)
            .and_then(|key| key.get_string(""))
            .ok()
            .or_else(|| {
                windows_registry::LOCAL_MACHINE
                    .open(key_path)
                    .and_then(|key| key.get_string(""))
                    .ok()
            });
        if let Some(path) = registered.as_deref().and_then(existing_registered_path) {
            return Some(path);
        }
    }
    None
}

#[cfg(any(windows, test))]
fn existing_registered_path(raw: &str) -> Option<PathBuf> {
    let path = Path::new(raw.trim().trim_matches('"'));
    path.is_file().then(|| path.to_path_buf())
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
    use std::fs;
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
        assert_eq!(
            cfg.executable_source,
            BrowserExecutableSource::ProcessEnvironment
        );
        env::remove_var("BROWSER_EXECUTABLE_PATH");
    }

    #[test]
    fn saved_executable_path_wins_over_a_stale_process_environment() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let stale = std::env::temp_dir().join("stale-browser.exe");
        let saved = std::env::temp_dir().join("managed-edge.exe");
        env::set_var("BROWSER_EXECUTABLE_PATH", stale);

        let cfg = CdpBackendConfig::from_env_with_saved_executable(Some(saved.clone()));

        assert_eq!(cfg.executable_path, Some(saved));
        assert_eq!(cfg.executable_source, BrowserExecutableSource::SavedSetting);
        env::remove_var("BROWSER_EXECUTABLE_PATH");
    }

    #[test]
    fn discovers_edge_in_a_managed_install_root() {
        let root = tempfile::tempdir().expect("temp browser root");
        let edge = root
            .path()
            .join("Microsoft")
            .join("Edge")
            .join("Application")
            .join("msedge.exe");
        fs::create_dir_all(edge.parent().expect("edge parent")).expect("create Edge path");
        fs::write(&edge, []).expect("create Edge executable fixture");

        assert_eq!(
            discover_browser_in_roots([root.path().to_path_buf()]),
            Some(edge)
        );
    }

    #[test]
    fn discovers_per_user_edge_channels() {
        let root = tempfile::tempdir().expect("temp browser root");
        let edge = root
            .path()
            .join("Microsoft")
            .join("Edge Dev")
            .join("Application")
            .join("msedge.exe");
        fs::create_dir_all(edge.parent().expect("edge parent")).expect("create Edge path");
        fs::write(&edge, []).expect("create Edge executable fixture");

        assert_eq!(
            discover_browser_in_roots([root.path().to_path_buf()]),
            Some(edge)
        );
    }

    #[test]
    fn accepts_quoted_registry_executable_paths() {
        let root = tempfile::tempdir().expect("temp browser root");
        let edge = root.path().join("msedge.exe");
        fs::write(&edge, []).expect("create Edge executable fixture");

        assert_eq!(
            existing_registered_path(&format!("\"{}\"", edge.display())),
            Some(edge)
        );
    }
}
