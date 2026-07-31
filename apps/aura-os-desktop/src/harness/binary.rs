//! Locate / stage the bundled `aura-node` sidecar binary.
//!
//! The desktop installer ships an `aura-node` executable next to the
//! desktop binary. We resolve which path to actually launch from at
//! runtime — explicit env override, bundled binary, or staged copy
//! under the data directory so updates can replace the original
//! while the previous version is still running.

use std::path::{Path, PathBuf};
use tracing::{info, warn};

use crate::init::env::env_string;

pub(crate) fn harness_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "aura-node.exe"
    } else {
        "aura-node"
    }
}

fn harness_resource_candidates() -> Vec<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    harness_resource_candidates_for(exe_dir.as_deref())
}

fn harness_resource_candidates_for(exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let binary_name = harness_binary_name();
    let mut candidates = Vec::new();

    if let Some(exe_dir) = exe_dir {
        // Prefer resources next to the running executable. In packaged
        // builds the compile-time CARGO_MANIFEST_DIR may still exist on a
        // developer machine, but macOS can block access to that source
        // tree behind a Files & Folders permission prompt before Aura has
        // created a window. The bundle is also the authoritative payload
        // that was signed and shipped with this exact desktop binary.
        candidates.push(exe_dir.join(binary_name));
        candidates.push(exe_dir.join("sidecar").join(binary_name));
        candidates.push(exe_dir.join("resources/sidecar").join(binary_name));
        if let Some(contents_dir) = exe_dir.parent() {
            candidates.push(contents_dir.join("Resources/sidecar").join(binary_name));
            candidates.push(
                contents_dir
                    .join("Resources/resources/sidecar")
                    .join(binary_name),
            );
        }
    }

    // Source-tree fallbacks keep `cargo run` and local development working
    // when no packaged resource is present next to the executable.
    candidates.extend([
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/sidecar")
            .join(binary_name),
        PathBuf::from("apps/aura-os-desktop/resources/sidecar").join(binary_name),
        PathBuf::from("resources/sidecar").join(binary_name),
    ]);

    candidates
}

fn managed_staging_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("runtime/sidecar")
}

fn is_managed_staged_harness_binary(path: &Path, data_dir: &Path) -> bool {
    path.starts_with(managed_staging_dir(data_dir))
}

pub(crate) fn inherited_managed_harness_binary_env(data_dir: &Path) -> bool {
    env_string("AURA_HARNESS_BIN")
        .map(PathBuf::from)
        .is_some_and(|path| is_managed_staged_harness_binary(&path, data_dir))
}

fn configured_harness_binary(data_dir: &Path) -> Option<PathBuf> {
    if let Some(explicit) = env_string("AURA_HARNESS_BIN") {
        let path = PathBuf::from(explicit);
        if is_managed_staged_harness_binary(&path, data_dir) {
            info!(
                path = %path.display(),
                "ignoring inherited managed AURA_HARNESS_BIN so bundled sidecar can be restaged"
            );
            return None;
        }
        if path.exists() {
            return Some(path);
        }
        warn!(path = %path.display(), "configured AURA_HARNESS_BIN does not exist");
    }
    None
}

fn find_bundled_harness_binary() -> Option<PathBuf> {
    for path in harness_resource_candidates() {
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn staged_harness_binary_name(source: &Path) -> String {
    let metadata = source.metadata().ok();
    let byte_len = metadata.as_ref().map(std::fs::Metadata::len).unwrap_or(0);
    let modified_secs = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("aura-node");
    let suffix = format!(
        "{stem}-{}-{byte_len}-{modified_secs}",
        crate::release_version::current_version()
    );
    match source.extension().and_then(|value| value.to_str()) {
        Some(ext) if !ext.is_empty() => format!("{suffix}.{ext}"),
        _ => suffix,
    }
}

pub(crate) fn stage_bundled_harness_binary(
    source: &Path,
    data_dir: &Path,
) -> Result<PathBuf, String> {
    let staged_dir = managed_staging_dir(data_dir);
    std::fs::create_dir_all(&staged_dir).map_err(|error| {
        format!(
            "failed to create staged harness directory {}: {error}",
            staged_dir.display()
        )
    })?;

    let staged_binary = staged_dir.join(staged_harness_binary_name(source));
    if staged_binary.is_file() {
        return Ok(staged_binary);
    }

    let temp_name = format!(
        ".{}.tmp-{}-{}",
        staged_binary
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("aura-node"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0)
    );
    let temp_binary = staged_dir.join(temp_name);

    std::fs::copy(source, &temp_binary).map_err(|error| {
        format!(
            "failed to copy bundled harness {} to {}: {error}",
            source.display(),
            temp_binary.display()
        )
    })?;

    let source_permissions =
        source
            .metadata()
            .map(|value| value.permissions())
            .map_err(|error| {
                format!(
                    "failed to read bundled harness permissions {}: {error}",
                    source.display()
                )
            })?;
    if let Err(error) = std::fs::set_permissions(&temp_binary, source_permissions) {
        let _ = std::fs::remove_file(&temp_binary);
        return Err(format!(
            "failed to preserve bundled harness permissions on {}: {error}",
            temp_binary.display()
        ));
    }

    if let Err(error) = std::fs::rename(&temp_binary, &staged_binary) {
        if staged_binary.exists() {
            let _ = std::fs::remove_file(&temp_binary);
            return Ok(staged_binary);
        }
        let _ = std::fs::remove_file(&temp_binary);
        return Err(format!(
            "failed to move staged harness into place {} -> {}: {error}",
            temp_binary.display(),
            staged_binary.display()
        ));
    }

    Ok(staged_binary)
}

pub(crate) fn resolve_managed_harness_binary(data_dir: &Path) -> Option<PathBuf> {
    if let Some(explicit) = configured_harness_binary(data_dir) {
        return Some(explicit);
    }

    let bundled = find_bundled_harness_binary()?;
    match stage_bundled_harness_binary(&bundled, data_dir) {
        Ok(staged) => {
            info!(
                source = %bundled.display(),
                staged = %staged.display(),
                "staged bundled local harness sidecar for runtime launch"
            );
            Some(staged)
        }
        Err(error) => {
            warn!(
                error = %error,
                source = %bundled.display(),
                "failed to stage bundled local harness sidecar; falling back to packaged resource"
            );
            Some(bundled)
        }
    }
}

/// Replace the managed staged copy with a fresh copy of the binary shipped in
/// the current app bundle.
///
/// This is intentionally limited to Aura's own staging directory. Explicit
/// operator-provided `AURA_HARNESS_BIN` paths are never removed or rewritten.
/// The caller must stop the failed child before invoking this function.
pub(crate) fn restage_bundled_harness_binary(
    current_binary: &Path,
    data_dir: &Path,
) -> Option<PathBuf> {
    if !is_managed_staged_harness_binary(current_binary, data_dir) {
        return None;
    }

    let bundled = find_bundled_harness_binary()?;
    restage_bundled_harness_binary_from_source(current_binary, data_dir, &bundled)
}

fn restage_bundled_harness_binary_from_source(
    current_binary: &Path,
    data_dir: &Path,
    bundled: &Path,
) -> Option<PathBuf> {
    if !is_managed_staged_harness_binary(current_binary, data_dir) {
        return None;
    }

    if let Err(error) = std::fs::remove_file(current_binary) {
        if error.kind() != std::io::ErrorKind::NotFound {
            warn!(
                %error,
                path = %current_binary.display(),
                "failed to remove unhealthy staged harness before retry"
            );
            return None;
        }
    }

    match stage_bundled_harness_binary(&bundled, data_dir) {
        Ok(staged) => {
            info!(
                source = %bundled.display(),
                staged = %staged.display(),
                "restaged bundled local harness sidecar after failed startup"
            );
            Some(staged)
        }
        Err(error) => {
            warn!(
                error = %error,
                source = %bundled.display(),
                "failed to restage bundled local harness sidecar after failed startup"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        configured_harness_binary, harness_binary_name, harness_resource_candidates_for,
        is_managed_staged_harness_binary, restage_bundled_harness_binary_from_source,
        stage_bundled_harness_binary,
    };
    use std::path::PathBuf;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn packaged_resource_candidates_precede_source_tree_fallbacks() {
        let exe_dir = PathBuf::from("/Applications/AURA.app/Contents/MacOS");
        let candidates = harness_resource_candidates_for(Some(&exe_dir));
        let packaged =
            PathBuf::from("/Applications/AURA.app/Contents/Resources/resources/sidecar/aura-node");
        let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/sidecar")
            .join(harness_binary_name());

        let packaged_index = candidates
            .iter()
            .position(|candidate| candidate == &packaged)
            .unwrap();
        let source_tree_index = candidates
            .iter()
            .position(|candidate| candidate == &source_tree)
            .unwrap();
        assert!(packaged_index < source_tree_index);
    }

    fn unique_test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "aura-os-desktop-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ))
    }

    #[test]
    fn stage_bundled_harness_binary_copies_into_runtime_dir() {
        let root = unique_test_dir("stage-sidecar");
        let source_dir = root.join("install/resources/sidecar");
        let data_dir = root.join("data");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&data_dir).unwrap();

        let source = source_dir.join(harness_binary_name());
        std::fs::write(&source, b"fake-sidecar-binary").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&source).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&source, perms).unwrap();
        }

        let staged = stage_bundled_harness_binary(&source, &data_dir).unwrap();
        assert_ne!(staged, source);
        assert!(staged.starts_with(data_dir.join("runtime/sidecar")));
        assert_eq!(std::fs::read(&staged).unwrap(), b"fake-sidecar-binary");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                std::fs::metadata(&staged).unwrap().permissions().mode() & 0o111,
                0
            );
        }

        let staged_again = stage_bundled_harness_binary(&source, &data_dir).unwrap();
        assert_eq!(staged_again, staged);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn managed_staged_harness_binary_detects_runtime_sidecar_path() {
        let data_dir = PathBuf::from("/tmp/aura-data");
        let managed = data_dir
            .join("runtime/sidecar")
            .join("aura-node-0.1.0-nightly.680.1");
        let external = PathBuf::from("/opt/aura-harness/aura-node");

        assert!(is_managed_staged_harness_binary(&managed, &data_dir));
        assert!(!is_managed_staged_harness_binary(&external, &data_dir));
    }

    #[test]
    fn restage_replaces_only_managed_binary() {
        let root = unique_test_dir("restage-sidecar");
        let source_dir = root.join("install/resources/sidecar");
        let data_dir = root.join("data");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&data_dir).unwrap();

        let source = source_dir.join(harness_binary_name());
        std::fs::write(&source, b"fresh-sidecar-binary").unwrap();
        let staged = stage_bundled_harness_binary(&source, &data_dir).unwrap();
        std::fs::write(&staged, b"corrupt").unwrap();

        let refreshed =
            restage_bundled_harness_binary_from_source(&staged, &data_dir, &source).unwrap();
        assert_eq!(refreshed, staged);
        assert_eq!(std::fs::read(refreshed).unwrap(), b"fresh-sidecar-binary");
        assert!(restage_bundled_harness_binary_from_source(
            PathBuf::from("/opt/aura-node").as_path(),
            &data_dir,
            &source,
        )
        .is_none());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn configured_harness_binary_ignores_inherited_managed_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        let previous = std::env::var("AURA_HARNESS_BIN").ok();
        let data_dir = unique_test_dir("managed-env");
        let inherited = data_dir
            .join("runtime/sidecar")
            .join("aura-node-0.1.0-nightly.680.1");

        std::env::set_var("AURA_HARNESS_BIN", &inherited);
        assert_eq!(configured_harness_binary(&data_dir), None);

        match previous {
            Some(value) => std::env::set_var("AURA_HARNESS_BIN", value),
            None => std::env::remove_var("AURA_HARNESS_BIN"),
        }
    }
}
