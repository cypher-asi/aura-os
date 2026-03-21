use std::collections::HashMap;
use std::path::Path;

use crate::error::EngineError;

use super::workspace_map::{
    parse_internal_deps, parse_package_name, parse_workspace_members, WorkspaceCache,
};
use super::task_keywords::{extract_task_keywords, identify_target_crates};
use super::file_walkers::{collect_tiered_files, resolve_dependency_signatures_bfs};

pub use super::type_resolution::{
    resolve_type_definitions_for_task,
    resolve_type_definitions_for_task_async,
};

/// Builds workspace context from disk (non-cached path).
struct WorkspaceContext {
    members: Vec<String>,
    crate_names: HashMap<String, String>,
    crate_deps: HashMap<String, Vec<String>>,
    name_to_path: HashMap<String, String>,
}

fn build_workspace_context_from_disk(root: &Path) -> Option<WorkspaceContext> {
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = std::fs::read_to_string(&root_cargo).ok()?;
    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return None;
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    let mut crate_deps: HashMap<String, Vec<String>> = HashMap::new();
    let mut name_to_path: HashMap<String, String> = HashMap::new();

    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        if let Ok(content) = std::fs::read_to_string(&member_cargo) {
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            let internal_deps = parse_internal_deps(&content);
            name_to_path.insert(name.clone(), member.clone());
            crate_names.insert(member.clone(), name);
            crate_deps.insert(member.clone(), internal_deps);
        }
    }

    Some(WorkspaceContext { members, crate_names, crate_deps, name_to_path })
}

/// Task-aware file retrieval with 4-tier priority.
pub fn retrieve_task_relevant_files(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let ctx = match build_workspace_context_from_disk(root) {
        Some(ctx) => ctx,
        None => return super::read_relevant_files(project_root, max_bytes),
    };

    let target_crates = identify_target_crates(task_title, task_description, &ctx.members, &ctx.crate_names);
    let keywords = extract_task_keywords(task_title, task_description);

    let dep_crate_paths: Vec<String> = target_crates
        .iter()
        .flat_map(|tc| ctx.crate_deps.get(tc).cloned().unwrap_or_default())
        .filter_map(|dep_name| ctx.name_to_path.get(&dep_name).cloned())
        .collect();

    collect_tiered_files(root, &target_crates, &dep_crate_paths, &keywords, max_bytes)
}

/// Resolve the public API surface of a target crate's workspace dependencies.
pub fn resolve_crate_api_context(
    project_root: &str,
    target_crate: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let ctx = match build_workspace_context_from_disk(root) {
        Some(ctx) => ctx,
        None => return Ok(String::new()),
    };

    let target_path = if ctx.members.contains(&target_crate.to_string()) {
        target_crate.to_string()
    } else if let Some(path) = ctx.name_to_path.get(target_crate) {
        path.clone()
    } else {
        return Ok(String::new());
    };

    Ok(resolve_dependency_signatures_bfs(
        root, &target_path, &ctx.crate_names, &ctx.crate_deps, &ctx.name_to_path, max_bytes,
    ))
}

/// Identify target crates from task description and resolve their dependency APIs.
pub fn resolve_task_dep_api_context(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = match std::fs::read_to_string(&root_cargo) {
        Ok(c) => c,
        Err(_) => return Ok(String::new()),
    };

    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return Ok(String::new());
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        if let Ok(content) = std::fs::read_to_string(&member_cargo) {
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            crate_names.insert(member.clone(), name);
        }
    }

    let targets = identify_target_crates(task_title, task_description, &members, &crate_names);
    if targets.is_empty() {
        return Ok(String::new());
    }

    let mut output = String::new();
    let mut remaining = max_bytes;

    for target in &targets {
        if remaining == 0 { break; }
        let section = resolve_crate_api_context(project_root, target, remaining)?;
        if !section.is_empty() {
            remaining = remaining.saturating_sub(section.len());
            output.push_str(&section);
        }
    }

    Ok(output)
}

/// Like `retrieve_task_relevant_files` but uses a pre-built `WorkspaceCache`.
pub async fn retrieve_task_relevant_files_cached(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
    cache: &WorkspaceCache,
) -> Result<String, EngineError> {
    let project_root = project_root.to_string();
    let task_title = task_title.to_string();
    let task_description = task_description.to_string();
    let cache = cache.clone();
    tokio::task::spawn_blocking(move || {
        retrieve_task_relevant_files_cached_sync(
            &project_root, &task_title, &task_description, max_bytes, &cache,
        )
    })
    .await
    .map_err(|e| EngineError::Io(format!("spawn_blocking: {e}")))?
}

fn retrieve_task_relevant_files_cached_sync(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
    cache: &WorkspaceCache,
) -> Result<String, EngineError> {
    if cache.members.is_empty() {
        return super::read_relevant_files(project_root, max_bytes);
    }

    let root = Path::new(project_root);
    let target_crates = identify_target_crates(
        task_title, task_description, &cache.members, &cache.crate_names,
    );
    let keywords = extract_task_keywords(task_title, task_description);

    let dep_crate_paths: Vec<String> = target_crates
        .iter()
        .flat_map(|tc| cache.crate_deps.get(tc).cloned().unwrap_or_default())
        .filter_map(|dep_name| cache.name_to_path.get(&dep_name).cloned())
        .collect();

    collect_tiered_files(root, &target_crates, &dep_crate_paths, &keywords, max_bytes)
}

/// Like `resolve_task_dep_api_context` but uses a pre-built `WorkspaceCache`.
pub async fn resolve_task_dep_api_context_cached(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
    cache: &WorkspaceCache,
) -> Result<String, EngineError> {
    let project_root = project_root.to_string();
    let task_title = task_title.to_string();
    let task_description = task_description.to_string();
    let cache = cache.clone();
    tokio::task::spawn_blocking(move || {
        resolve_task_dep_api_context_cached_sync(
            &project_root, &task_title, &task_description, max_bytes, &cache,
        )
    })
    .await
    .map_err(|e| EngineError::Io(format!("spawn_blocking: {e}")))?
}

fn resolve_task_dep_api_context_cached_sync(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
    cache: &WorkspaceCache,
) -> Result<String, EngineError> {
    if cache.members.is_empty() {
        return Ok(String::new());
    }

    let targets = identify_target_crates(
        task_title, task_description, &cache.members, &cache.crate_names,
    );
    if targets.is_empty() {
        return Ok(String::new());
    }

    let root = Path::new(project_root);
    let mut output = String::new();
    let mut remaining = max_bytes;

    for target in &targets {
        if remaining == 0 { break; }

        let target_path = if cache.members.contains(target) {
            target.clone()
        } else if let Some(path) = cache.name_to_path.get(target) {
            path.clone()
        } else {
            continue;
        };

        let section = resolve_dependency_signatures_bfs(
            root, &target_path, &cache.crate_names, &cache.crate_deps,
            &cache.name_to_path, remaining,
        );

        if !section.is_empty() {
            remaining = remaining.saturating_sub(section.len());
            output.push_str(&section);
        }
    }

    Ok(output)
}
