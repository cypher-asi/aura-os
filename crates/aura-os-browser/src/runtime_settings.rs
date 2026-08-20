//! Persistent machine-local settings for the browser runtime.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::Error;

const RUNTIME_SETTINGS_SCHEMA_VERSION: u32 = 1;

/// Machine-local browser settings stored below `BrowserConfig::settings_root`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserRuntimeSettings {
    /// File schema version, reserved for future migrations.
    pub schema_version: u32,
    /// User-selected Edge, Chrome, or Chromium executable.
    #[serde(default)]
    pub executable_path: Option<PathBuf>,
}

impl Default for BrowserRuntimeSettings {
    fn default() -> Self {
        Self {
            schema_version: RUNTIME_SETTINGS_SCHEMA_VERSION,
            executable_path: None,
        }
    }
}

impl BrowserRuntimeSettings {
    /// Return the runtime-settings file beneath a browser settings root.
    pub fn path(settings_root: &Path) -> PathBuf {
        settings_root.join("runtime.json")
    }

    /// Read settings synchronously during application startup.
    ///
    /// A missing file returns defaults. A corrupt or unreadable file is also
    /// ignored so browser configuration can never prevent AURA from starting.
    pub fn load(settings_root: &Path) -> Self {
        let path = Self::path(settings_root);
        match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(settings) => settings,
                Err(error) => {
                    warn!(path = %path.display(), %error, "browser runtime settings are corrupt; using defaults");
                    Self::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(error) => {
                warn!(path = %path.display(), %error, "browser runtime settings could not be read; using defaults");
                Self::default()
            }
        }
    }

    pub(crate) async fn save(&self, settings_root: &Path) -> Result<(), Error> {
        let path = Self::path(settings_root);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| Error::Settings {
                    path: path.clone(),
                    detail: format!("create_dir_all: {error}"),
                })?;
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(|error| Error::Settings {
            path: path.clone(),
            detail: format!("serialize: {error}"),
        })?;
        let temporary = path.with_extension("json.tmp");
        tokio::fs::write(&temporary, bytes)
            .await
            .map_err(|error| Error::Settings {
                path: path.clone(),
                detail: format!("write tmp {}: {error}", temporary.display()),
            })?;
        if let Err(error) = tokio::fs::rename(&temporary, &path).await {
            // Windows does not replace an existing destination with rename.
            // Retry after removing this single, fully-resolved settings file.
            #[cfg(windows)]
            if path.is_file() {
                tokio::fs::remove_file(&path)
                    .await
                    .map_err(|remove_error| Error::Settings {
                        path: path.clone(),
                        detail: format!("replace existing settings after {error}: {remove_error}"),
                    })?;
                return tokio::fs::rename(&temporary, &path)
                    .await
                    .map_err(|retry_error| Error::Settings {
                        path,
                        detail: format!("rename replacement tmp: {retry_error}"),
                    });
            }
            return Err(Error::Settings {
                path,
                detail: format!("rename tmp: {error}"),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn settings_round_trip() {
        let root = tempfile::tempdir().expect("temp runtime settings");
        let expected = root.path().join("msedge.exe");
        BrowserRuntimeSettings {
            executable_path: Some(expected.clone()),
            ..BrowserRuntimeSettings::default()
        }
        .save(root.path())
        .await
        .expect("save runtime settings");

        let loaded = BrowserRuntimeSettings::load(root.path());
        assert_eq!(loaded.executable_path, Some(expected));

        BrowserRuntimeSettings::default()
            .save(root.path())
            .await
            .expect("replace runtime settings");
        assert!(BrowserRuntimeSettings::load(root.path())
            .executable_path
            .is_none());
    }

    #[test]
    fn corrupt_settings_fall_back_to_defaults() {
        let root = tempfile::tempdir().expect("temp runtime settings");
        std::fs::write(BrowserRuntimeSettings::path(root.path()), b"not json")
            .expect("write corrupt fixture");

        assert!(BrowserRuntimeSettings::load(root.path())
            .executable_path
            .is_none());
    }
}
