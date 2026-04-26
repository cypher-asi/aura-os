//! Project ↔ on-disk notes folder binding and one-time migrations.
//!
//! Notes for a project live either under `<workspace>/notes/` (when the
//! project has a `local_workspace_path`) or under `<data_dir>/notes/<slug>/`,
//! pinned by a `.project-id` marker that survives renames. This module owns
//! all the folder-creation, migration, and orphan-recovery logic so the
//! handler modules can treat the resulting `PathBuf` as a black box.

use std::path::{Path, PathBuf};

use aura_os_core::ProjectId;
use aura_os_projects::ProjectService;
use tracing::{debug, warn};

use super::paths::slug_stem;
use crate::error::{ApiError, ApiResult};

pub(super) const PROJECT_ID_MARKER: &str = ".project-id";

/// Resolve a project's notes root.
///
/// Precedence:
/// 1. If the project has a `local_workspace_path` configured (Project
///    Settings > Local workspace), notes live at `<workspace>/notes/` so
///    they travel with the rest of the project's files on disk. Changing
///    the workspace path causes a one-time migration of any existing
///    slug-bound folder into the new location.
/// 2. Otherwise, fall back to a human-friendly slug folder under
///    `<data_dir>/notes/<slug>/`, pinned by a `.project-id` marker so the
///    folder stays stable across project renames.
/// 3. When the project record can't be loaded (deleted/unknown project),
///    fall back to the legacy `<data_dir>/notes/<project_id>/` path so
///    reads still work for orphaned data.
fn resolve_notes_root(
    data_dir: &Path,
    project_service: &ProjectService,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    let notes_dir = data_dir.join("notes");
    create_dir(&notes_dir)?;

    let legacy_uuid = notes_dir.join(project_id.to_string());

    let project = match project_service.get_project(project_id) {
        Ok(p) => p,
        Err(_) => {
            create_dir(&legacy_uuid)?;
            return Ok(legacy_uuid);
        }
    };

    let workspace = project
        .local_workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    if let Some(workspace_root) = workspace {
        return resolve_workspace_root(&workspace_root, &notes_dir, project_id);
    }

    resolve_slug_root(&notes_dir, &legacy_uuid, &project.name, project_id)
}

/// `<workspace>/notes/`-backed root. Migrates a previously-bound slug folder
/// into the workspace location on first use after a workspace change.
fn resolve_workspace_root(
    workspace_root: &Path,
    notes_dir: &Path,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    let ws_notes = workspace_root.join("notes");

    let marker = ws_notes.join(PROJECT_ID_MARKER);
    let marker_matches = std::fs::read_to_string(&marker)
        .ok()
        .is_some_and(|c| c.trim() == project_id.to_string());
    if marker_matches {
        return Ok(ws_notes);
    }

    create_dir(&ws_notes)?;

    if let Some(bound) = find_bound_folder(notes_dir, project_id) {
        if bound != ws_notes {
            if let Err(err) = move_notes_contents(&bound, &ws_notes) {
                warn!(
                    from = %bound.display(),
                    to = %ws_notes.display(),
                    %err,
                    "failed to migrate notes into workspace folder; \
                     continuing with empty workspace notes folder",
                );
            } else {
                let _ = std::fs::remove_file(bound.join(PROJECT_ID_MARKER));
            }
        }
    }

    if let Err(err) = std::fs::write(&marker, project_id.to_string()) {
        warn!(
            path = %marker.display(),
            %err,
            "failed to write project-id marker in workspace notes folder",
        );
    }
    Ok(ws_notes)
}

/// `<data_dir>/notes/<slug>/`-backed root used when no workspace is set.
fn resolve_slug_root(
    notes_dir: &Path,
    legacy_uuid: &Path,
    project_name: &str,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    if let Some(bound) = find_bound_folder(notes_dir, project_id) {
        return Ok(bound);
    }

    let candidate = pick_unused_slug(notes_dir, project_name);
    materialize_slug_folder(legacy_uuid, &candidate)?;

    let marker = candidate.join(PROJECT_ID_MARKER);
    if let Err(err) = std::fs::write(&marker, project_id.to_string()) {
        warn!(path = %marker.display(), %err, "failed to write project-id marker");
    }

    Ok(candidate)
}

fn pick_unused_slug(notes_dir: &Path, project_name: &str) -> PathBuf {
    let base = slug_stem(project_name);
    let mut candidate = notes_dir.join(&base);
    let mut counter = 2u32;
    while candidate.exists() {
        candidate = notes_dir.join(format!("{base}-{counter}"));
        counter += 1;
        if counter > 10_000 {
            break;
        }
    }
    candidate
}

/// Promote the legacy `<uuid>/` folder to a slug folder when present, or
/// create the slug folder fresh.
fn materialize_slug_folder(legacy_uuid: &Path, candidate: &Path) -> ApiResult<()> {
    if legacy_uuid.exists() && !candidate.exists() {
        if let Err(err) = std::fs::rename(legacy_uuid, candidate) {
            warn!(
                from = %legacy_uuid.display(),
                to = %candidate.display(),
                %err,
                "failed to migrate legacy notes folder; creating fresh",
            );
            create_dir(candidate)?;
        }
        return Ok(());
    }
    create_dir(candidate)
}

fn create_dir(path: &Path) -> ApiResult<()> {
    std::fs::create_dir_all(path).map_err(|e| {
        ApiError::internal(format!(
            "failed to create notes directory {}: {e}",
            path.display()
        ))
    })
}

/// Move every non-marker entry from `from` into `to`. If any individual
/// entry can't be moved (e.g. a cross-device move in exotic setups), fall
/// back to a copy+delete. Returns the first error encountered so callers
/// can log and keep going.
pub(super) fn move_notes_contents(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    let entries = std::fs::read_dir(from)?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == PROJECT_ID_MARKER {
            continue;
        }
        let src = entry.path();
        let dst = to.join(&name);
        if dst.exists() {
            warn!(
                from = %src.display(),
                to = %dst.display(),
                "destination already exists; skipping move",
            );
            continue;
        }
        if let Err(err) = std::fs::rename(&src, &dst) {
            debug!(
                from = %src.display(),
                to = %dst.display(),
                %err,
                "rename failed; falling back to copy",
            );
            copy_recursive(&src, &dst)?;
            if src.is_dir() {
                let _ = std::fs::remove_dir_all(&src);
            } else {
                let _ = std::fs::remove_file(&src);
            }
        }
    }
    Ok(())
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)?.flatten() {
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ())
    }
}

/// Scan `notes_dir/*/.project-id` looking for a folder already bound to this
/// project. Returns the bound folder on match.
fn find_bound_folder(notes_dir: &Path, project_id: &ProjectId) -> Option<PathBuf> {
    let entries = std::fs::read_dir(notes_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let marker = path.join(PROJECT_ID_MARKER);
        let Ok(contents) = std::fs::read_to_string(&marker) else {
            continue;
        };
        if contents.trim() == project_id.to_string() {
            return Some(path);
        }
    }
    None
}

/// Ensure the notes root exists and return it.
pub(super) fn ensure_notes_root(
    data_dir: &Path,
    project_service: &ProjectService,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    resolve_notes_root(data_dir, project_service, project_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn move_notes_contents_relocates_files_and_folders() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("old");
        let to = tmp.path().join("new");
        std::fs::create_dir_all(&from).unwrap();
        std::fs::write(from.join("a.md"), "# A").unwrap();
        std::fs::create_dir_all(from.join("folder")).unwrap();
        std::fs::write(from.join("folder/b.md"), "# B").unwrap();
        std::fs::write(from.join(PROJECT_ID_MARKER), "proj-1").unwrap();

        move_notes_contents(&from, &to).unwrap();

        assert!(to.join("a.md").is_file());
        assert!(to.join("folder/b.md").is_file());
        assert!(!to.join(PROJECT_ID_MARKER).exists());
        assert!(!from.join("a.md").exists());
        assert!(!from.join("folder").exists());
        assert!(from.join(PROJECT_ID_MARKER).exists());
    }

    #[test]
    fn move_notes_contents_does_not_clobber_existing_destination() {
        let tmp = TempDir::new().unwrap();
        let from = tmp.path().join("old");
        let to = tmp.path().join("new");
        std::fs::create_dir_all(&from).unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(from.join("shared.md"), "FROM").unwrap();
        std::fs::write(to.join("shared.md"), "PRE_EXISTING").unwrap();

        move_notes_contents(&from, &to).unwrap();

        assert_eq!(
            std::fs::read_to_string(to.join("shared.md")).unwrap(),
            "PRE_EXISTING"
        );
        assert!(from.join("shared.md").is_file());
    }

    #[test]
    fn copy_recursive_copies_nested_tree() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        std::fs::create_dir_all(src.join("a/b")).unwrap();
        std::fs::write(src.join("a/b/leaf.md"), "leaf").unwrap();
        std::fs::write(src.join("root.md"), "root").unwrap();

        copy_recursive(&src, &dst).unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("a/b/leaf.md")).unwrap(),
            "leaf"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("root.md")).unwrap(),
            "root"
        );
        assert!(src.join("a/b/leaf.md").is_file());
    }

    #[test]
    fn resolve_notes_root_prefers_workspace_when_configured() {
        use aura_os_core::{OrgId, ProjectId};
        use aura_os_projects::{CreateProjectInput, ProjectService, UpdateProjectInput};
        use aura_os_store::SettingsStore;
        use std::sync::Arc;

        let tmp = TempDir::new().unwrap();
        let data_dir = tmp.path().join("data");
        let workspace = tmp.path().join("ws");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&workspace).unwrap();

        let store_dir = tmp.path().join("store");
        let store = Arc::new(SettingsStore::open(&store_dir).unwrap());
        let project_service = ProjectService::new(store);

        let project = project_service
            .create_project(CreateProjectInput {
                org_id: OrgId::new(),
                name: "My Product".into(),
                description: String::new(),
                build_command: None,
                test_command: None,
                local_workspace_path: None,
            })
            .unwrap();
        let project_id: ProjectId = project.project_id;

        let root_a = resolve_notes_root(&data_dir, &project_service, &project_id).unwrap();
        assert!(root_a.starts_with(data_dir.join("notes")));
        std::fs::write(root_a.join("seed.md"), "# Seed").unwrap();

        project_service
            .update_project(
                &project_id,
                UpdateProjectInput {
                    local_workspace_path: Some(Some(workspace.to_string_lossy().into_owned())),
                    ..Default::default()
                },
            )
            .unwrap();

        let root_b = resolve_notes_root(&data_dir, &project_service, &project_id).unwrap();
        assert_eq!(root_b, workspace.join("notes"));
        assert!(root_b.join("seed.md").is_file());
        assert_eq!(
            std::fs::read_to_string(root_b.join(PROJECT_ID_MARKER))
                .unwrap()
                .trim(),
            project_id.to_string()
        );

        let root_c = resolve_notes_root(&data_dir, &project_service, &project_id).unwrap();
        assert_eq!(root_c, root_b);
    }
}
