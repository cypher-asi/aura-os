pub mod agent_events;
mod app_builder;
mod auth_guard;
mod billing_bridge;
pub(crate) mod billing_rollup;
mod capture_auth;
pub(crate) mod channel_ext;
pub(crate) mod dto;
pub(crate) mod error;
pub mod handlers;
pub mod harness_client;
pub(crate) mod harness_gateway;
mod network_bridge;
pub mod orbit_guard;

mod loop_events_bridge;
pub mod loop_log;

pub(crate) mod orchestration_store;
#[allow(dead_code)]
pub(crate) mod persistence;
pub(crate) mod process_automaton;
pub(crate) mod reconciler;
pub(crate) mod router;
pub(crate) mod state;
pub(crate) mod sync_state;

pub use app_builder::build_app_state;
pub use harness_client::{
    bearer_headers, GetHeadResponse, HarnessClient, HarnessClientError, HarnessProbeResult,
    HarnessTxKind, SubmitTxResponse,
};
pub use harness_gateway::HarnessHttpGateway;
pub use router::{build_local_api_cors_layer, create_router_with_interface};
pub use state::{ActiveAutomaton, AppState, CachedSession};

/// Discover common user-level binary directories (pip `--user` scripts, `~/.local/bin`,
/// etc.) and append any that exist but are missing from `PATH`.  Call once at startup
/// so child processes (the harness, terminals) inherit the augmented `PATH` and can
/// find CLI tools installed via `pip install --user` or `uv tool install`.
pub fn ensure_user_bins_on_path() {
    use std::path::PathBuf;

    let mut extra: Vec<PathBuf> = Vec::new();

    // ~/.local/bin  (uv tool install, pipx, pip --user on Linux/macOS)
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".local").join("bin");
        if p.is_dir() {
            extra.push(p);
        }
    }

    #[cfg(windows)]
    {
        // Microsoft Store Python: %LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.*\…\Scripts
        if let Some(local) = dirs::data_local_dir() {
            let packages = local.join("Packages");
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    if !entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("PythonSoftwareFoundation.Python.3")
                    {
                        continue;
                    }
                    let base = entry.path().join("LocalCache").join("local-packages");
                    if let Ok(inner) = std::fs::read_dir(&base) {
                        for ie in inner.flatten() {
                            if ie.file_name().to_string_lossy().starts_with("Python3") {
                                let s = ie.path().join("Scripts");
                                if s.is_dir() {
                                    extra.push(s);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Standard pip --user: %APPDATA%\Python\Python3*\Scripts
        if let Some(roaming) = dirs::config_dir() {
            let python_dir = roaming.join("Python");
            if let Ok(entries) = std::fs::read_dir(&python_dir) {
                for entry in entries.flatten() {
                    let s = entry.path().join("Scripts");
                    if s.is_dir() {
                        extra.push(s);
                    }
                }
            }
        }
    }

    if extra.is_empty() {
        return;
    }

    let current = std::env::var_os("PATH").unwrap_or_default();
    let existing: std::collections::HashSet<PathBuf> = std::env::split_paths(&current).collect();

    let new_dirs: Vec<&PathBuf> = extra.iter().filter(|d| !existing.contains(*d)).collect();
    if new_dirs.is_empty() {
        return;
    }

    let mut all: Vec<PathBuf> = std::env::split_paths(&current).collect();
    for d in &new_dirs {
        tracing::debug!(path = %d.display(), "Appending user binary directory to PATH");
        all.push(d.to_path_buf());
    }
    if let Ok(joined) = std::env::join_paths(&all) {
        std::env::set_var("PATH", &joined);
    }
}

/// Thin re-exports of internal helpers that Phase 7 integration tests
/// exercise directly. Not a stable public API.
#[path = "lib/phase7_test_support.rs"]
#[doc(hidden)]
pub mod phase7_test_support;

#[path = "lib/handlers_test_support.rs"]
pub mod handlers_test_support;
