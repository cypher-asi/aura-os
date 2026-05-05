//! Filesystem layout for the desktop binary's data, store, and bundled
//! interface assets.

use std::path::{Path, PathBuf};
use tracing::{info, warn};

pub(crate) fn default_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("AURA_DATA_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aura")
}

pub(crate) fn find_interface_dir() -> Option<PathBuf> {
    let compile_time = PathBuf::from(env!("INTERFACE_DIST_DIR"));
    if compile_time.join("index.html").exists() {
        return Some(compile_time);
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    interface_dir_candidates(exe_dir.as_deref())
        .into_iter()
        .find(|p| p.join("index.html").exists())
}

pub(crate) fn interface_dir_candidates(exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("interface/dist"),
        PathBuf::from("../../interface/dist"),
    ];
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("interface/dist"));
        candidates.push(dir.join("dist"));
        if let Some(contents_dir) = dir.parent() {
            candidates.push(contents_dir.join("Resources/dist"));
            candidates.push(contents_dir.join("Resources/interface/dist"));
        }
    }

    candidates
}

pub(crate) fn init_data_dirs() -> (PathBuf, PathBuf, Option<PathBuf>) {
    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");
    info!(path = %data_dir.display(), "data directory ready");

    let store_path = data_dir.join("store");
    migrate_legacy_db_dir(&data_dir, &store_path);
    let webview_data_dir = data_dir.join("webview");
    let interface_dir = find_interface_dir();
    match interface_dir {
        Some(ref dir) => info!(path = %dir.display(), "serving interface"),
        None => warn!("no interface dist found; pages will not load"),
    }
    (store_path, webview_data_dir, interface_dir)
}

/// One-shot migration: the local settings store used to live in `<data>/db/`
/// (when it was briefly backed by RocksDB). It's now plain JSON under
/// `<data>/store/`. If the old path exists and the new one doesn't, rename.
fn migrate_legacy_db_dir(data_dir: &Path, store_path: &Path) {
    let legacy = data_dir.join("db");
    if legacy.exists() && !store_path.exists() {
        match std::fs::rename(&legacy, store_path) {
            Ok(()) => info!(
                from = %legacy.display(),
                to = %store_path.display(),
                "migrated legacy db/ directory to store/"
            ),
            Err(err) => warn!(
                error = %err,
                from = %legacy.display(),
                to = %store_path.display(),
                "failed to migrate legacy db/ directory; continuing with fresh store/"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::interface_dir_candidates;
    use std::path::{Path, PathBuf};

    #[test]
    fn interface_dir_candidates_include_macos_bundle_resources() {
        let exe_dir = Path::new("/tmp/AURA.app/Contents/MacOS");
        let candidates = interface_dir_candidates(Some(exe_dir));

        assert!(candidates.contains(&PathBuf::from("/tmp/AURA.app/Contents/Resources/dist")));
        assert!(candidates.contains(&PathBuf::from(
            "/tmp/AURA.app/Contents/Resources/interface/dist"
        )));
    }
}
