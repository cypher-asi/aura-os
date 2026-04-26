//! Notes-tree walking and the `GET /tree` handler.
//!
//! Exposes a single recursive walker that mirrors the on-disk folder
//! structure 1:1 (folders first, then `.md` files, both alphabetical) and
//! the matching axum handler that emits it as JSON.

use std::path::Path;

use aura_os_core::ProjectId;
use axum::extract::{Path as AxumPath, State};
use axum::Json;
use serde::Serialize;

use super::frontmatter::{extract_title, read_title_probe, strip_md_ext};
use super::paths::{rel_of, system_time_to_rfc3339, to_forward_slashes};
use super::root::{ensure_notes_root, PROJECT_ID_MARKER};
use crate::error::ApiResult;
use crate::state::{AppState, AuthSession};

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum TreeNode {
    Folder {
        name: String,
        #[serde(rename = "relPath")]
        rel_path: String,
        children: Vec<TreeNode>,
    },
    Note {
        name: String,
        #[serde(rename = "relPath")]
        rel_path: String,
        title: String,
        #[serde(rename = "absPath")]
        abs_path: String,
        #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
        updated_at: Option<String>,
    },
}

pub(super) fn walk_notes(root: &Path, current: &Path) -> Vec<TreeNode> {
    let Ok(entries) = std::fs::read_dir(current) else {
        return Vec::new();
    };
    let mut items: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.file_name().cmp(&b.file_name()))
    });
    let mut out = Vec::new();
    for entry in items {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.ends_with(".comments.json") || name == PROJECT_ID_MARKER {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            out.push(TreeNode::Folder {
                name: name.clone(),
                rel_path: rel_of(root, &path),
                children: walk_notes(root, &path),
            });
        } else if name.ends_with(".md") {
            out.push(note_tree_node(root, &entry, &name));
        }
    }
    out
}

fn note_tree_node(root: &Path, entry: &std::fs::DirEntry, name: &str) -> TreeNode {
    let path = entry.path();
    let title_probe = read_title_probe(&path).ok().unwrap_or_default();
    let title = extract_title(&title_probe);
    let display_title = if title.is_empty() {
        strip_md_ext(name).to_string()
    } else {
        title
    };
    let updated_at = entry
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(system_time_to_rfc3339);
    TreeNode::Note {
        name: name.to_string(),
        rel_path: rel_of(root, &path),
        title: display_title,
        abs_path: to_forward_slashes(&path),
        updated_at,
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct TreeResponse {
    pub(crate) nodes: Vec<TreeNode>,
    pub(crate) root: String,
}

pub(crate) async fn list_tree(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
) -> ApiResult<Json<TreeResponse>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let root_for_walk = root.clone();
    let nodes = tokio::task::spawn_blocking(move || walk_notes(&root_for_walk, &root_for_walk))
        .await
        .unwrap_or_default();
    Ok(Json(TreeResponse {
        nodes,
        root: to_forward_slashes(&root),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("notes").join("proj-1");
        std::fs::create_dir_all(&root).unwrap();
        (tmp, root)
    }

    #[tokio::test]
    async fn walk_includes_folders_and_notes_sorted() {
        let (_tmp, root) = setup();
        std::fs::create_dir_all(root.join("Alpha")).unwrap();
        std::fs::write(root.join("Alpha/one.md"), "# Alpha one").unwrap();
        std::fs::write(root.join("z-root.md"), "# Z Root").unwrap();
        std::fs::write(root.join(".hidden"), "skip").unwrap();
        std::fs::write(root.join("z-root.md.comments.json"), "{\"comments\":[]}").unwrap();

        let nodes = walk_notes(&root, &root);
        assert_eq!(nodes.len(), 2);
        match &nodes[0] {
            TreeNode::Folder { name, children, .. } => {
                assert_eq!(name, "Alpha");
                assert_eq!(children.len(), 1);
                match &children[0] {
                    TreeNode::Note { title, .. } => assert_eq!(title, "Alpha one"),
                    _ => panic!("expected note"),
                }
            }
            _ => panic!("expected folder first"),
        }
        match &nodes[1] {
            TreeNode::Note {
                title, rel_path, ..
            } => {
                assert_eq!(title, "Z Root");
                assert_eq!(rel_path, "z-root.md");
            }
            _ => panic!("expected note"),
        }
    }

    #[test]
    fn walk_skips_project_id_marker() {
        let (_tmp, root) = setup();
        std::fs::write(root.join(PROJECT_ID_MARKER), "abc-123").unwrap();
        std::fs::write(root.join("kept.md"), "# Kept").unwrap();
        let nodes = walk_notes(&root, &root);
        assert_eq!(nodes.len(), 1);
        match &nodes[0] {
            TreeNode::Note { title, .. } => assert_eq!(title, "Kept"),
            _ => panic!("expected note"),
        }
    }
}
