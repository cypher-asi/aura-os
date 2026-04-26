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
    let binary_name = harness_binary_name();
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/sidecar")
            .join(binary_name),
        PathBuf::from("apps/aura-os-desktop/resources/sidecar").join(binary_name),
        PathBuf::from("resources/sidecar").join(binary_name),
    ];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
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
    }

    candidates
}

fn configured_harness_binary() -> Option<PathBuf> {
    if let Some(explicit) = env_string("AURA_HARNESS_BIN") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Some(path);
        }
        warn!(path = %path.display(), "configured AURA_HARNESS_BIN does not exist");
    }
    None
}

fn find_bundled_harness_binary() -> Option<PathBuf> {
    harness_resource_candidates()
        .into_iter()
        .find(|path| path.is_file())
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
        env!("CARGO_PKG_VERSION")
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
    let staged_dir = data_dir.join("runtime/sidecar");
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
    if let Some(explicit) = configured_harness_binary() {
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

#[cfg(test)]
mod tests {
    use super::{harness_binary_name, stage_bundled_harness_binary};
    use std::path::PathBuf;

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
}
