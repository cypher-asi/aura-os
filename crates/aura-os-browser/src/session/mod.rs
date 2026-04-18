//! Per-session plumbing, plus the project-aware settings/discovery/resolver
//! subsystems that are the client's "sophisticated way to know current
//! project settings".

mod handle;
pub mod discovery;
pub mod probe;
pub mod resolver;
pub mod settings;

pub use handle::{SessionHandle, SessionId};
pub use settings::{
    DetectedUrl, DetectionSource, HistoryEntry, ProjectBrowserSettings, SettingsPatch,
    SettingsStore, HISTORY_CAP, DETECTED_URLS_CAP,
};
