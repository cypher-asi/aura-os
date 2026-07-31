//! Filesystem layout for the desktop binary's data, store, and bundled
//! interface assets.

use aura_os_core::Channel;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// Marker file dropped into the Stable data dir after a one-shot
/// `aura-dev` -> `aura` migration runs. Its presence is the sole signal
/// that we've already attempted the move on this machine.
const DEV_TO_STABLE_MIGRATION_MARKER: &str = ".migrated-from-aura-dev";

pub(crate) fn default_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("AURA_DATA_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(Channel::current().data_dir_name())
}

pub(crate) fn find_interface_dir() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    interface_dir_candidates(exe_dir.as_deref())
        .into_iter()
        .find(|p| p.join("index.html").exists())
        .or_else(|| {
            // Source-tree fallback for `cargo run`. Packaged builds must use
            // their own signed resource first: a compile-time path under
            // Documents can be blocked by macOS privacy controls and leave
            // the visible webview stuck on `about:blank`.
            let compile_time = PathBuf::from(env!("INTERFACE_DIST_DIR"));
            compile_time
                .join("index.html")
                .exists()
                .then_some(compile_time)
        })
}

pub(crate) fn interface_dir_candidates(exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("interface/dist"));
        candidates.push(dir.join("dist"));
        if let Some(contents_dir) = dir.parent() {
            candidates.push(contents_dir.join("Resources/dist"));
            candidates.push(contents_dir.join("Resources/interface/dist"));
        }
    }
    candidates.extend([
        PathBuf::from("interface/dist"),
        PathBuf::from("../../interface/dist"),
    ]);

    candidates
}

pub(crate) fn init_data_dirs() -> (PathBuf, PathBuf, Option<PathBuf>) {
    let data_dir = default_data_dir();
    // On Stable, run the one-shot recovery of data the *previous*
    // (broken) stable build wrote into the Dev tree. We need this to
    // happen BEFORE `create_dir_all` so the rename path can use a
    // cheap same-volume move when the destination doesn't exist yet
    // (otherwise Windows aborts the rename because the target
    // directory already exists, even if it's empty).
    if Channel::current() == Channel::Stable {
        if let Some(local_data) = dirs::data_local_dir() {
            migrate_legacy_dev_data_dir(&local_data, &data_dir);
        }
        if let Some(home) = dirs::home_dir() {
            migrate_legacy_dev_skills_dir(&home);
        }
    }
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

/// One-shot recovery of the data dir that the *previous* (channel-bug)
/// stable build wrote to. Until the channel selection bug was fixed,
/// the installer-shipped "AURA" silently resolved to `Channel::Dev` and
/// wrote everything to `<local>/aura-dev/` even though the binary
/// advertised itself as stable. With the fix in place, Stable now
/// correctly resolves to `<local>/aura/` — but that directory is empty
/// on every upgrading user. Move their data over once.
///
/// Rules:
/// - Source is `<local>/aura-dev/`.
/// - Destination is `<local>/aura/` (the now-corrected Stable dir).
/// - Skip entirely if a marker file already exists in the destination
///   (we've already done this on this machine).
/// - Skip if the source doesn't contain any user data we recognise
///   (avoid moving an empty Dev tree just because it exists).
/// - Refuse to clobber: if the destination already has a `store/` we
///   leave both trees alone and just drop the marker so we don't keep
///   re-asking.
/// - Best-effort: a rename failure logs a warning and continues with
///   the empty Stable dir; we still drop the marker to avoid retrying
///   on every launch.
pub(super) fn migrate_legacy_dev_data_dir(local_data_root: &Path, stable_data_dir: &Path) {
    let marker = stable_data_dir.join(DEV_TO_STABLE_MIGRATION_MARKER);
    if marker.exists() {
        return;
    }

    let dev_dir = local_data_root.join("aura-dev");
    if !dev_data_dir_has_user_state(&dev_dir) {
        return;
    }

    let stable_store = stable_data_dir.join("store");
    if stable_store.exists() {
        warn!(
            dev = %dev_dir.display(),
            stable = %stable_data_dir.display(),
            "skipping aura-dev -> aura data migration: both trees exist; leaving each in place"
        );
        let _ = drop_migration_marker(stable_data_dir, &marker, "destination already populated");
        return;
    }

    if let Err(err) = std::fs::create_dir_all(stable_data_dir) {
        warn!(
            error = %err,
            stable = %stable_data_dir.display(),
            "failed to create stable data dir for aura-dev migration; skipping"
        );
        return;
    }

    match move_dir_contents(&dev_dir, stable_data_dir) {
        Ok(()) => {
            info!(
                from = %dev_dir.display(),
                to = %stable_data_dir.display(),
                "migrated aura-dev/ contents into aura/ (recovery from channel-selection bug)"
            );
            let _ = drop_migration_marker(stable_data_dir, &marker, "migration succeeded");
        }
        Err(err) => {
            warn!(
                error = %err,
                from = %dev_dir.display(),
                to = %stable_data_dir.display(),
                "failed to migrate aura-dev/ contents into aura/; continuing with empty stable dir"
            );
            let _ = drop_migration_marker(stable_data_dir, &marker, "migration failed");
        }
    }
}

/// Sibling of `migrate_legacy_dev_data_dir` for the skills tree under
/// the user's home directory. The bug also redirected the published
/// stable build's `~/.aura/skills` to `~/.aura-dev/skills`; mirror the
/// same one-shot recovery there.
pub(super) fn migrate_legacy_dev_skills_dir(home: &Path) {
    let stable_skills_home = home.join(".aura");
    let stable_skills = stable_skills_home.join("skills");
    let marker = stable_skills_home.join(DEV_TO_STABLE_MIGRATION_MARKER);
    if marker.exists() {
        return;
    }

    let dev_skills = home.join(".aura-dev").join("skills");
    if !dev_skills.exists() {
        return;
    }
    if dir_is_empty(&dev_skills) {
        return;
    }
    if stable_skills.exists() && !dir_is_empty(&stable_skills) {
        warn!(
            dev = %dev_skills.display(),
            stable = %stable_skills.display(),
            "skipping aura-dev skills -> aura skills migration: both trees populated; leaving each in place"
        );
        let _ = drop_migration_marker(
            &stable_skills_home,
            &marker,
            "destination already populated",
        );
        return;
    }

    if let Err(err) = std::fs::create_dir_all(&stable_skills_home) {
        warn!(
            error = %err,
            stable = %stable_skills_home.display(),
            "failed to create ~/.aura for skills migration; skipping"
        );
        return;
    }
    // Remove an empty placeholder destination so `rename` succeeds on
    // Windows (the OS refuses MoveFileEx onto an existing directory
    // even when it's empty).
    if stable_skills.exists() {
        let _ = std::fs::remove_dir(&stable_skills);
    }

    match std::fs::rename(&dev_skills, &stable_skills) {
        Ok(()) => {
            info!(
                from = %dev_skills.display(),
                to = %stable_skills.display(),
                "migrated ~/.aura-dev/skills -> ~/.aura/skills (recovery from channel-selection bug)"
            );
            let _ =
                drop_migration_marker(&stable_skills_home, &marker, "skills migration succeeded");
        }
        Err(err) => {
            // Fall back to a recursive copy + best-effort delete: rename
            // can fail across volumes (rare on $LOCALAPPDATA but
            // possible if the user redirected one tree via a junction).
            match copy_dir_recursive(&dev_skills, &stable_skills) {
                Ok(()) => {
                    info!(
                        from = %dev_skills.display(),
                        to = %stable_skills.display(),
                        rename_error = %err,
                        "copied ~/.aura-dev/skills -> ~/.aura/skills (rename unavailable)"
                    );
                    if let Err(remove_err) = std::fs::remove_dir_all(&dev_skills) {
                        warn!(
                            error = %remove_err,
                            from = %dev_skills.display(),
                            "skills copied but failed to remove ~/.aura-dev/skills; remove it manually if you don't need it"
                        );
                    }
                    let _ = drop_migration_marker(
                        &stable_skills_home,
                        &marker,
                        "skills migration via copy",
                    );
                }
                Err(copy_err) => {
                    warn!(
                        rename_error = %err,
                        copy_error = %copy_err,
                        from = %dev_skills.display(),
                        to = %stable_skills.display(),
                        "failed to migrate ~/.aura-dev/skills; continuing with empty ~/.aura/skills"
                    );
                    let _ = drop_migration_marker(
                        &stable_skills_home,
                        &marker,
                        "skills migration failed",
                    );
                }
            }
        }
    }
}

fn dev_data_dir_has_user_state(dev_dir: &Path) -> bool {
    if !dev_dir.is_dir() {
        return false;
    }
    // `store/` is the smoking-gun marker for "this Dev tree was treated
    // as the real production data dir". `desktop-route.json` /
    // `webview/` / `logs/` / `workspaces/` are all created on first
    // launch even if the user did nothing, so they're not strong
    // signals on their own — but if any of them appears alongside a
    // non-empty filesystem we still want to preserve it.
    if dev_dir.join("store").is_dir() {
        return true;
    }
    let secondary_signals = [
        "desktop-route.json",
        "webview",
        "workspaces",
        "logs",
        "browser",
    ];
    secondary_signals
        .iter()
        .any(|name| dev_dir.join(name).exists())
}

fn dir_is_empty(path: &Path) -> bool {
    match std::fs::read_dir(path) {
        Ok(mut iter) => iter.next().is_none(),
        Err(_) => true,
    }
}

fn drop_migration_marker(dir: &Path, marker: &Path, reason: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(
        marker,
        format!("aura-os-desktop one-shot aura-dev migration marker\nreason: {reason}\n"),
    )
}

/// Move every direct child of `from` into `to`. `to` must already exist
/// and be empty; `from` is left empty (and we attempt to remove it).
fn move_dir_contents(from: &Path, to: &Path) -> std::io::Result<()> {
    let entries = std::fs::read_dir(from)?;
    for entry in entries {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        match std::fs::rename(&src, &dst) {
            Ok(()) => {}
            Err(err) => {
                // Fall back to a copy for cross-volume / cross-junction
                // moves. We deliberately don't propagate the copy
                // failure as the rename error: the user-visible problem
                // is the move, and copy_dir_recursive returns the more
                // useful one.
                if src.is_dir() {
                    copy_dir_recursive(&src, &dst)?;
                    std::fs::remove_dir_all(&src)?;
                } else {
                    std::fs::copy(&src, &dst).map_err(|copy_err| {
                        std::io::Error::new(
                            copy_err.kind(),
                            format!("rename failed ({err}); copy failed ({copy_err})"),
                        )
                    })?;
                    let _ = std::fs::remove_file(&src);
                }
            }
        }
    }
    // The Dev dir itself is left in place if any contents resisted
    // moving (we'd hit `?` above), so we only try to remove it on the
    // happy path. Best-effort: ignore the result.
    let _ = std::fs::remove_dir(from);
    Ok(())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else if file_type.is_symlink() {
            // Symlinks in $LOCALAPPDATA/aura-dev are exotic; skip
            // rather than failing the whole migration.
            warn!(
                src = %src.display(),
                "skipping symlink during aura-dev migration"
            );
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        interface_dir_candidates, migrate_legacy_dev_data_dir, migrate_legacy_dev_skills_dir,
        DEV_TO_STABLE_MIGRATION_MARKER,
    };
    use std::fs;
    use std::path::{Path, PathBuf};

    #[test]
    fn interface_dir_candidates_include_macos_bundle_resources() {
        let exe_dir = Path::new("/tmp/AURA.app/Contents/MacOS");
        let candidates = interface_dir_candidates(Some(exe_dir));

        assert!(candidates.contains(&PathBuf::from("/tmp/AURA.app/Contents/Resources/dist")));
        assert!(candidates.contains(&PathBuf::from(
            "/tmp/AURA.app/Contents/Resources/interface/dist"
        )));
        assert!(
            candidates
                .iter()
                .position(|candidate| {
                    candidate == Path::new("/tmp/AURA.app/Contents/Resources/dist")
                })
                .unwrap()
                < candidates
                    .iter()
                    .position(|candidate| candidate == Path::new("interface/dist"))
                    .unwrap()
        );
    }

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn migrate_legacy_dev_data_dir_moves_populated_dev_into_empty_stable() {
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path();
        let dev = local.join("aura-dev");
        let stable = local.join("aura");
        write(&dev.join("store").join("settings.json"), "{}");
        write(&dev.join("desktop-route.json"), "\"/home\"");

        migrate_legacy_dev_data_dir(local, &stable);

        assert!(stable.join("store").join("settings.json").is_file());
        assert!(stable.join("desktop-route.json").is_file());
        assert!(
            !dev.exists() || fs::read_dir(&dev).unwrap().next().is_none(),
            "dev dir should be empty (or removed) after migration: {:?}",
            fs::read_dir(&dev).ok().map(|r| r.count())
        );
        assert!(
            stable.join(DEV_TO_STABLE_MIGRATION_MARKER).is_file(),
            "marker file must be dropped so the migration is one-shot"
        );
    }

    #[test]
    fn migrate_legacy_dev_data_dir_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path();
        let dev = local.join("aura-dev");
        let stable = local.join("aura");
        write(&dev.join("store").join("a.json"), "first");

        migrate_legacy_dev_data_dir(local, &stable);
        // Re-stage dev data and run again; the marker should make us skip.
        write(&dev.join("store").join("b.json"), "second");
        migrate_legacy_dev_data_dir(local, &stable);

        assert!(stable.join("store").join("a.json").is_file());
        assert!(
            !stable.join("store").join("b.json").exists(),
            "marker should have blocked the second migration"
        );
        assert!(
            dev.join("store").join("b.json").is_file(),
            "second-run dev data must be left alone"
        );
    }

    #[test]
    fn migrate_legacy_dev_data_dir_refuses_to_clobber_populated_stable() {
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path();
        let dev = local.join("aura-dev");
        let stable = local.join("aura");
        write(&dev.join("store").join("dev.json"), "dev");
        write(&stable.join("store").join("stable.json"), "stable");

        migrate_legacy_dev_data_dir(local, &stable);

        assert!(stable.join("store").join("stable.json").is_file());
        assert!(
            !stable.join("store").join("dev.json").exists(),
            "stable store must not be overwritten with dev data"
        );
        assert!(
            dev.join("store").join("dev.json").is_file(),
            "dev data should be preserved when destination is populated"
        );
        assert!(
            stable.join(DEV_TO_STABLE_MIGRATION_MARKER).is_file(),
            "marker should still be dropped to avoid re-asking on every launch"
        );
    }

    #[test]
    fn migrate_legacy_dev_data_dir_skips_empty_source() {
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path();
        let stable = local.join("aura");

        migrate_legacy_dev_data_dir(local, &stable);

        assert!(
            !stable.exists(),
            "stable dir must not be eagerly created when dev tree has no user state"
        );
    }

    #[test]
    fn migrate_legacy_dev_skills_dir_moves_populated_dev_into_empty_stable() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let dev = home.join(".aura-dev").join("skills");
        let stable = home.join(".aura").join("skills");
        write(&dev.join("my-skill").join("SKILL.md"), "# Skill");

        migrate_legacy_dev_skills_dir(home);

        assert!(stable.join("my-skill").join("SKILL.md").is_file());
        assert!(!dev.exists(), "dev skills dir should be moved away");
        assert!(home
            .join(".aura")
            .join(DEV_TO_STABLE_MIGRATION_MARKER)
            .is_file());
    }
}
