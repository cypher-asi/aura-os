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
    stage_bundled_harness_binary_for_platform(source, data_dir, cfg!(target_os = "windows"))
}

fn stable_sidecar_build_identity(source: &Path) -> Result<String, String> {
    use std::hash::Hasher;
    use std::io::Read;
    // This is a cache identity, not a security signature. Hash the payload so
    // equal-size rebuilds with preserved timestamps cannot reuse an old copy.
    let mut file = std::fs::File::open(source)
        .map_err(|error| format!("failed to read bundled sidecar build: {error}"))?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut buf = [0; 65536];
    loop {
        let len = file
            .read(&mut buf)
            .map_err(|error| format!("failed to fingerprint bundled sidecar: {error}"))?;
        if len == 0 {
            break;
        }
        hasher.write(&buf[..len]);
    }
    Ok(format!(
        "{}-{:016x}",
        crate::release_version::current_version(),
        hasher.finish()
    ))
}

fn stage_bundled_harness_binary_for_platform(
    source: &Path,
    data_dir: &Path,
    stable_path: bool,
) -> Result<PathBuf, String> {
    let staged_dir = managed_staging_dir(data_dir);
    std::fs::create_dir_all(&staged_dir).map_err(|error| {
        format!(
            "failed to create staged harness directory {}: {error}",
            staged_dir.display()
        )
    })?;

    let fingerprint = if stable_path {
        stable_sidecar_build_identity(source)?
    } else {
        staged_harness_binary_name(source)
    };
    // Firewall program rules follow the full executable path. Keep that path
    // stable on Windows, and record the build identity separately instead.
    let staged_binary = staged_dir.join(if stable_path {
        "aura-node.exe".to_string()
    } else {
        fingerprint.clone()
    });
    let build_record = staged_dir.join("aura-node.build");
    let matching_build = !stable_path
        || std::fs::read_to_string(&build_record).ok().as_deref() == Some(&fingerprint);
    if staged_binary.is_file() && matching_build {
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

    if stable_path {
        if let Err(error) = stop_staged_windows_sidecar(&staged_binary) {
            let _ = std::fs::remove_file(&temp_binary);
            return Err(error);
        }
    }
    // Windows cannot overwrite a running executable. Retain the old copy
    // until installation succeeds, and restore it if the final move fails.
    let backup = temp_binary.with_extension("previous");
    let had_previous = stable_path && staged_binary.is_file();
    if had_previous {
        if let Err(error) = std::fs::rename(&staged_binary, &backup) {
            let _ = std::fs::remove_file(&temp_binary);
            return Err(format!("failed to move previous sidecar aside: {error}"));
        }
    }
    if let Err(error) = std::fs::rename(&temp_binary, &staged_binary) {
        if had_previous {
            let _ = std::fs::rename(&backup, &staged_binary);
        }
        let _ = std::fs::remove_file(&temp_binary);
        return Err(format!(
            "failed to move staged harness into place {} -> {}: {error}",
            temp_binary.display(),
            staged_binary.display()
        ));
    }
    if had_previous {
        let _ = std::fs::remove_file(&backup);
    }
    if stable_path {
        std::fs::write(&build_record, &fingerprint)
            .map_err(|error| format!("failed to record staged sidecar build: {error}"))?;
    }

    Ok(staged_binary)
}

#[cfg(target_os = "windows")]
fn stop_staged_windows_sidecar(binary: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    if !binary.is_file() {
        return Ok(());
    }
    // CIM preserves the launch path (including 8.3 aliases such as RUNNER~1).
    // Resolve both paths on disk before comparing, not just our expected path.
    let output = std::process::Command::new("powershell.exe")
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter \"Name = 'aura-node.exe'\" | ForEach-Object { Write-Output ($_.ProcessId.ToString() + '|' + $_.ExecutablePath) }"])
        .output()
        .map_err(|error| format!("failed to discover previous managed sidecar: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "failed to discover previous managed sidecar: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid, executable)) = line.trim().split_once('|') else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        if !same_windows_path(Path::new(executable), binary) {
            continue;
        }
        // Revalidate the original CIM path and PID immediately before stopping
        // it, so a reused PID cannot select an unrelated process.
        let stopped = std::process::Command::new("powershell.exe")
            .creation_flags(0x0800_0000)
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter \"ProcessId = $env:AURA_SIDECAR_REPLACE_PID\" | Where-Object { $_.Name -eq 'aura-node.exe' -and $_.ExecutablePath -eq $env:AURA_SIDECAR_REPLACE_PATH } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Wait-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }"])
            .env("AURA_SIDECAR_REPLACE_PID", pid.to_string())
            .env("AURA_SIDECAR_REPLACE_PATH", executable)
            .output()
            .map_err(|error| format!("failed to stop previous managed sidecar: {error}"))?;
        if !stopped.status.success() {
            return Err(format!(
                "failed to stop previous managed sidecar: {}",
                String::from_utf8_lossy(&stopped.stderr)
            ));
        }
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn same_windows_path(actual: &Path, expected: &Path) -> bool {
    match (actual.canonicalize(), expected.canonicalize()) {
        (Ok(actual), Ok(expected)) => match (actual.to_str(), expected.to_str()) {
            (Some(actual), Some(expected)) => {
                windows_process_path(actual) == windows_process_path(expected)
            }
            _ => false,
        },
        _ => false,
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_process_path(path: &str) -> String {
    let native = path.replace('/', "\\");
    if let Some(unc) = native.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        native.strip_prefix(r"\\?\").unwrap_or(&native).to_string()
    }
}

#[cfg(not(target_os = "windows"))]
fn stop_staged_windows_sidecar(_binary: &Path) -> Result<(), String> {
    Ok(())
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
        same_windows_path, stage_bundled_harness_binary, stage_bundled_harness_binary_for_platform,
        windows_process_path,
    };
    use std::path::PathBuf;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn packaged_resource_candidates_precede_source_tree_fallbacks() {
        let exe_dir = PathBuf::from("/Applications/AURA.app/Contents/MacOS");
        let candidates = harness_resource_candidates_for(Some(&exe_dir));
        let packaged = PathBuf::from("/Applications/AURA.app/Contents/Resources/resources/sidecar")
            .join(harness_binary_name());
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
    fn windows_process_paths_match_cim_native_paths() {
        let expected = r"C:\Aura\runtime\sidecar\aura-node.exe";
        assert_eq!(
            windows_process_path(r"C:\Aura\runtime/sidecar\aura-node.exe"),
            expected
        );
        assert_eq!(
            windows_process_path(r"\\?\C:\Aura\runtime\sidecar\aura-node.exe"),
            expected
        );
        assert_eq!(
            windows_process_path(r"\\?\UNC\server\share\aura-node.exe"),
            r"\\server\share\aura-node.exe"
        );
    }

    #[test]
    fn windows_executable_identity_requires_the_same_existing_path() {
        let root = tempfile::tempdir().unwrap();
        let managed_dir = root.path().join("managed");
        let external_dir = root.path().join("external");
        std::fs::create_dir_all(&managed_dir).unwrap();
        std::fs::create_dir_all(&external_dir).unwrap();
        let managed = managed_dir.join("aura-node.exe");
        let external = external_dir.join("aura-node.exe");
        std::fs::write(&managed, b"same-payload").unwrap();
        std::fs::write(&external, b"same-payload").unwrap();
        assert!(same_windows_path(
            &managed,
            &managed.canonicalize().unwrap()
        ));
        assert!(same_windows_path(
            &managed_dir.join("../managed/aura-node.exe"),
            &managed
        ));
        assert!(!same_windows_path(&external, &managed));
        assert!(!same_windows_path(
            &root.path().join("missing.exe"),
            &managed
        ));
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
    fn windows_sidecar_updates_keep_the_executable_path() {
        let root = unique_test_dir("stable-windows-sidecar");
        let source_dir = root.join("install");
        let data_dir = root.join("data");
        std::fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("aura-node.exe");
        std::fs::write(&source, b"old-build").unwrap();
        let first = stage_bundled_harness_binary_for_platform(&source, &data_dir, true).unwrap();
        assert_eq!(first, data_dir.join("runtime/sidecar/aura-node.exe"));
        let first_record =
            std::fs::read_to_string(first.with_file_name("aura-node.build")).unwrap();
        // Same length: identity must come from the payload, not its size.
        std::fs::write(&source, b"new-build").unwrap();
        let second = stage_bundled_harness_binary_for_platform(&source, &data_dir, true).unwrap();
        assert_eq!(first, second);
        assert_eq!(std::fs::read(&second).unwrap(), b"new-build");
        assert_ne!(
            std::fs::read_to_string(second.with_file_name("aura-node.build")).unwrap(),
            first_record
        );
        assert_eq!(
            stage_bundled_harness_binary_for_platform(&source, &data_dir, true).unwrap(),
            second
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn windows_sidecar_without_build_record_is_refreshed() {
        let root = unique_test_dir("missing-windows-build-record");
        let source_dir = root.join("install");
        let data_dir = root.join("data");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(data_dir.join("runtime/sidecar")).unwrap();
        let source = source_dir.join("aura-node.exe");
        std::fs::write(&source, b"bundled-build").unwrap();
        std::fs::write(
            data_dir.join("runtime/sidecar/aura-node.exe"),
            b"stale-build",
        )
        .unwrap();
        let staged = stage_bundled_harness_binary_for_platform(&source, &data_dir, true).unwrap();
        assert_eq!(std::fs::read(staged).unwrap(), b"bundled-build");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_sidecar_process_probe() {
        let Some(ready) = std::env::var_os("AURA_SIDECAR_TEST_READY") else {
            return;
        };
        std::fs::write(ready, b"ready").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(60));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_update_stops_only_the_previous_managed_executable() {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        struct Probe(std::process::Child);
        impl Drop for Probe {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("bundled.exe");
        std::fs::copy(std::env::current_exe().unwrap(), &source).unwrap();
        let data = root.path().join("data");
        let staged = stage_bundled_harness_binary(&source, &data).unwrap();
        let external = root.path().join("external/aura-node.exe");
        std::fs::create_dir_all(external.parent().unwrap()).unwrap();
        std::fs::copy(&source, &external).unwrap();
        let spawn = |binary: &std::path::Path, label: &str| {
            let ready = root.path().join(label);
            let child = std::process::Command::new(binary)
                .creation_flags(0x0800_0000)
                .args([
                    "--exact",
                    "harness::binary::tests::windows_sidecar_process_probe",
                ])
                .env("AURA_SIDECAR_TEST_READY", &ready)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap();
            let probe = Probe(child);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while !ready.exists() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            assert!(ready.exists(), "sidecar probe did not start");
            probe
        };
        let mut managed = spawn(&staged, "managed-ready");
        let mut unrelated = spawn(&external, "external-ready");
        let previous_identity = super::stable_sidecar_build_identity(&source).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&source)
            .unwrap()
            .write_all(b"new-build")
            .unwrap();
        assert_ne!(
            super::stable_sidecar_build_identity(&source).unwrap(),
            previous_identity,
            "fixture payload must trigger a sidecar replacement"
        );
        assert_eq!(
            stage_bundled_harness_binary(&source, &data).unwrap(),
            staged
        );
        if managed.0.try_wait().unwrap().is_none() {
            // Keep the live-process assertion strict, but expose the runner's
            // actual process identity instead of guessing at a path mismatch.
            let diagnostic = std::process::Command::new("powershell.exe")
                .creation_flags(0x0800_0000)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $env:AURA_TEST_MANAGED_PID -or $_.ProcessId -eq $env:AURA_TEST_EXTERNAL_PID } | Select-Object ProcessId, Name, ExecutablePath | Format-List",
                ])
                .env("AURA_TEST_MANAGED_PID", managed.0.id().to_string())
                .env("AURA_TEST_EXTERNAL_PID", unrelated.0.id().to_string())
                .output()
                .unwrap();
            panic!(
                "previous managed process still running: staged={}, canonical={}, source={}, diagnostic status={}, stdout={}, stderr={}",
                staged.display(),
                staged.canonicalize().unwrap().display(),
                source.display(),
                diagnostic.status,
                String::from_utf8_lossy(&diagnostic.stdout),
                String::from_utf8_lossy(&diagnostic.stderr),
            );
        }
        assert!(unrelated.0.try_wait().unwrap().is_none());
        assert_eq!(
            std::fs::read(&staged).unwrap(),
            std::fs::read(&source).unwrap()
        );
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
