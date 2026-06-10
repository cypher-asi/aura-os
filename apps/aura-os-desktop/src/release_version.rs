//! Runtime release version lookup.
//!
//! CI packages a small `resources/release.json` file with the installer version.
//! Reading it at runtime keeps updater semantics tied to the shipped artifact
//! version without forcing a full desktop binary rebuild for every nightly run
//! number. Local/dev builds fall back to Cargo's package version.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tracing::warn;

#[derive(Debug, Deserialize)]
struct ReleaseMetadata {
    version: String,
}

static CURRENT_VERSION: OnceLock<String> = OnceLock::new();

pub(crate) fn current_version() -> &'static str {
    CURRENT_VERSION
        .get_or_init(|| {
            read_release_version().unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
        })
        .as_str()
}

fn read_release_version() -> Option<String> {
    if let Ok(version) = std::env::var("AURA_DESKTOP_RELEASE_VERSION") {
        let version = version.trim();
        if !version.is_empty() {
            return Some(version.to_string());
        }
    }

    for path in release_metadata_candidates() {
        if !path.is_file() {
            continue;
        }

        match parse_release_metadata(&path) {
            Ok(version) => return Some(version),
            Err(error) => {
                warn!(
                    path = %path.display(),
                    error = %error,
                    "failed to read desktop release metadata; falling back to Cargo package version"
                );
            }
        }
    }

    None
}

fn parse_release_metadata(path: &Path) -> Result<String, String> {
    let bytes =
        std::fs::read(path).map_err(|error| format!("failed to read release metadata: {error}"))?;
    let metadata: ReleaseMetadata = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse release metadata json: {error}"))?;
    let version = metadata.version.trim();
    if version.is_empty() {
        return Err("release metadata version is empty".into());
    }
    Ok(version.to_string())
}

fn release_metadata_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/release.json"),
        PathBuf::from("apps/aura-os-desktop/resources/release.json"),
        PathBuf::from("resources/release.json"),
    ];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join("release.json"));
            candidates.push(exe_dir.join("resources/release.json"));
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(contents_dir.join("Resources/release.json"));
                candidates.push(contents_dir.join("Resources/resources/release.json"));
            }
        }
    }

    candidates
}

#[cfg(test)]
mod tests {
    use super::parse_release_metadata;

    #[test]
    fn parses_release_metadata_version() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("release.json");
        std::fs::write(&path, r#"{ "version": "0.1.0-nightly.620.1" }"#).expect("write");

        assert_eq!(
            parse_release_metadata(&path).expect("parse"),
            "0.1.0-nightly.620.1"
        );
    }

    #[test]
    fn rejects_empty_release_metadata_version() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("release.json");
        std::fs::write(&path, r#"{ "version": " " }"#).expect("write");

        assert!(parse_release_metadata(&path).is_err());
    }
}
