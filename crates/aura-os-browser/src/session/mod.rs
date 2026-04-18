//! Per-session plumbing, plus the project-aware settings/discovery/resolver
//! subsystems that are the client's "sophisticated way to know current
//! project settings".

pub mod discovery;
mod handle;
pub mod probe;
pub mod resolver;
pub mod settings;

pub use handle::{SessionHandle, SessionId};
pub use settings::{
    DetectedUrl, DetectionSource, HistoryEntry, ProjectBrowserSettings, SettingsPatch,
    SettingsStore, DETECTED_URLS_CAP, HISTORY_CAP,
};
