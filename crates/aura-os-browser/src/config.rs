//! Runtime configuration and per-call option structs.

use std::path::PathBuf;
use std::time::Duration;

use aura_os_core::ProjectId;
use url::Url;

/// Runtime configuration shared by every session.
///
/// Tune the hot-path knobs via environment variables in
/// [`BrowserConfig::from_env`] so ops can change them without a redeploy.
#[derive(Debug, Clone)]
pub struct BrowserConfig {
    /// Root directory under which per-project settings files live.
    ///
    /// Files are written to `<settings_root>/projects/<project_id>.json`
    /// plus a `<settings_root>/global.json` for projectless browsing.
    pub settings_root: PathBuf,

    /// Maximum concurrent live sessions. Exceeding this returns
    /// [`Error::CapacityExceeded`](crate::Error::CapacityExceeded).
    pub max_sessions: usize,

    /// Default per-frame JPEG quality for the screencast. `[1, 100]`.
    pub frame_quality: u8,

    /// Cap on CDP screencast FPS. Chromium throttles via `everyNthFrame`.
    pub max_fps: u8,

    /// Total budget for an active port probe attempt.
    pub probe_budget: Duration,

    /// TCP connect timeout for a single port during an active probe.
    pub probe_per_port_timeout: Duration,

    /// Timeout for a single navigate() call.
    pub navigate_timeout: Duration,
}

impl Default for BrowserConfig {
    fn default() -> Self {
        Self {
            settings_root: default_settings_root(),
            max_sessions: 4,
            frame_quality: 60,
            max_fps: 30,
            probe_budget: Duration::from_secs(1),
            probe_per_port_timeout: Duration::from_millis(50),
            navigate_timeout: Duration::from_secs(30),
        }
    }
}

impl BrowserConfig {
    /// Override the on-disk root used for the settings files. Mostly useful
    /// for tests; production callers should set this once during boot to
    /// `<state.data_dir>/browser`.
    pub fn with_settings_root(mut self, root: PathBuf) -> Self {
        self.settings_root = root;
        self
    }

    /// Return the file path for a given project's settings.
    pub fn project_settings_path(&self, project_id: &ProjectId) -> PathBuf {
        self.settings_root
            .join("projects")
            .join(format!("{project_id}.json"))
    }

    /// Return the file path for the projectless (global) settings file.
    pub fn global_settings_path(&self) -> PathBuf {
        self.settings_root.join("global.json")
    }
}

fn default_settings_root() -> PathBuf {
    PathBuf::from(".aura").join("browser")
}

/// Options for creating a new browser session.
#[derive(Debug, Clone)]
pub struct SpawnOptions {
    /// Initial viewport width.
    pub width: u16,
    /// Initial viewport height.
    pub height: u16,
    /// When set, overrides the project-resolved initial URL.
    pub initial_url: Option<Url>,
    /// When set, the session belongs to this project and persists visits +
    /// records detected URLs into that project's settings file.
    pub project_id: Option<ProjectId>,
    /// Override for the JPEG quality used by the screencast. `None` uses the
    /// manager-level default from [`BrowserConfig::frame_quality`].
    pub frame_quality: Option<u8>,
}

impl SpawnOptions {
    /// Build a minimal [`SpawnOptions`] with a given viewport size.
    pub fn new(width: u16, height: u16) -> Self {
        Self {
            width,
            height,
            initial_url: None,
            project_id: None,
            frame_quality: None,
        }
    }
}

/// Options controlling initial URL resolution.
#[derive(Debug, Clone, Default)]
pub struct ResolveOptions {
    /// When true and the resolver falls through to the last fallback, an
    /// active port probe runs to try and find a live dev server.
    pub allow_active_probe: bool,
}
