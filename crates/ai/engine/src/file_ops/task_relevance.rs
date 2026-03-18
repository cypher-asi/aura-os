use std::collections::HashMap;
use std::path::Path;

use regex::Regex;

use crate::error::EngineError;

use super::workspace_map::{
    extract_signatures_from_content, parse_internal_deps, parse_package_name,
    parse_workspace_members, read_signatures_only, WorkspaceCache,
};
use super::{INCLUDE_EXTENSIONS, SKIP_DIRS};

/// Parse task title and description for crate names, type names, and module
/// names.  Returns a deduplicated list of keywords useful for matching files.
fn extract_task_keywords(task_title: &str, task_description: &str) -> Vec<String> {
    let combined = format!("{} {}", task_title, task_description);
    let mut keywords: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let type_re = Regex::new(r"\b([A-Z][a-zA-Z0-9]+)\b").unwrap();
    for cap in type_re.captures_iter(&combined) {
        let word = cap[1].to_string();
        if word.len() >= 3 && !COMMON_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            keywords.push(word);
        }
    }

    let crate_re = Regex::new(r"\b(aura[_-]\w+)\b").unwrap();
    for cap in crate_re.captures_iter(&combined) {
        let name = cap[1].replace('-', "_");
        if seen.insert(name.clone()) {
            keywords.push(name);
        }
    }

    let mod_re = Regex::new(r"\b([a-z][a-z0-9_]{2,})\b").unwrap();
    for cap in mod_re.captures_iter(&combined) {
        let word = cap[1].to_string();
        if !COMMON_MODULE_STOP_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            keywords.push(word);
        }
    }

    keywords
}

const COMMON_WORDS: &[&str] = &[
    "The", "This", "That", "With", "From", "Into", "Each", "Some", "None",
    "Result", "Option", "String", "Vec", "HashMap", "Arc", "Box", "Mutex",
    "Default", "Clone", "Debug", "Display", "Error", "Send", "Sync",
    "Implement", "Create", "Update", "Delete", "Add", "Remove", "Set", "Get",
    "New", "Test", "Build", "Run", "Fix", "Use", "For", "All", "Any",
];

const COMMON_MODULE_STOP_WORDS: &[&str] = &[
    "the", "this", "that", "with", "from", "into", "each", "some", "none",
    "and", "for", "not", "are", "but", "all", "any", "can", "has", "was",
    "will", "use", "its", "let", "new", "our", "try", "may", "should",
    "must", "also", "just", "than", "then", "when", "who", "how", "what",
    "pub", "mod", "impl", "self", "super", "crate", "where", "type",
    "struct", "enum", "trait", "async", "await", "move", "return",
    "true", "false", "mut", "ref", "str", "run", "set", "get", "add",
    "using", "create", "implement", "update", "delete", "task", "file",
    "code", "test", "build", "make", "does", "like", "have", "been",
];

/// Identify which workspace crate(s) the task most likely targets based on
/// keywords in the title and description.  Returns the member paths (e.g.
/// `"crates/domain/orgs"`) sorted by relevance.
fn identify_target_crates(
    task_title: &str,
    task_description: &str,
    members: &[String],
    crate_names: &HashMap<String, String>,
) -> Vec<String> {
    let combined = format!("{} {}", task_title, task_description).to_lowercase();

    let mut scored: Vec<(String, u32)> = members
        .iter()
        .map(|member| {
            let name = crate_names
                .get(member)
                .cloned()
                .unwrap_or_default()
                .to_lowercase();
            let name_underscored = name.replace('-', "_");
            let name_dashed = name.replace('_', "-");
            let mut score: u32 = 0;

            if combined.contains(&name)
                || combined.contains(&name_underscored)
                || combined.contains(&name_dashed)
            {
                score += 10;
            }

            let last_segment = member.rsplit('/').next().unwrap_or(member);
            if combined.contains(&last_segment.to_lowercase()) {
                score += 5;
            }

            (member.clone(), score)
        })
        .filter(|(_, score)| *score > 0)
        .collect();

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.into_iter().map(|(m, _)| m).collect()
}

/// Task-aware file retrieval: instead of a purely alphabetical walk, parse the
/// task description to identify target crates and prioritize relevant files.
///
/// Tiered priority:
/// - **Tier 1**: Target crate's Cargo.toml, lib.rs/main.rs, mod.rs files
/// - **Tier 2**: Dependency crates' lib.rs (signatures only)
/// - **Tier 3**: Files matching keyword patterns from the task description
/// - **Tier 4**: Remaining workspace files alphabetically (fallback)
pub fn retrieve_task_relevant_files(
    project_root: &str,
    task_title: &str,
    task_description: &str,
    max_bytes: usize,
) -> Result<String, EngineError> {
    let root = Path::new(project_root);
    let root_cargo = root.join("Cargo.toml");
    let cargo_content = match std::fs::read_to_string(&root_cargo) {
        Ok(c) => c,
        Err(_) => return super::read_relevant_files(project_root, max_bytes),
    };

    let members = parse_workspace_members(&cargo_content);
    if members.is_empty() {
        return super::read_relevant_files(project_root, max_bytes);
    }

    let mut crate_names: HashMap<String, String> = HashMap::new();
    let mut crate_internal_deps: HashMap<String, Vec<String>> = HashMap::new();

    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        if let Ok(content) = std::fs::read_to_string(&member_cargo) {
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            let deps = parse_internal_deps(&content);
            crate_names.insert(member.clone(), name);
            crate_internal_deps.insert(member.clone(), deps);
        }
    }

    let target_crates =
        identify_target_crates(task_title, task_description, &members, &crate_names);
    let keywords = extract_task_keywords(task_title, task_description);

    let name_to_path: HashMap<String, String> = crate_names
        .iter()
        .map(|(path, name)| (name.clone(), path.clone()))
        .collect();

    let mut output = String::new();
    let mut current_size: usize = 0;
    let mut included_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Tier 1: Target crate core files
    for target in &target_crates {
        if current_size >= max_bytes {
            break;
        }
        let crate_dir = root.join(target);

        let core_files = [
            crate_dir.join("Cargo.toml"),
            crate_dir.join("src").join("lib.rs"),
            crate_dir.join("src").join("main.rs"),
            crate_dir.join("src").join("mod.rs"),
        ];

        for file in &core_files {
            if current_size >= max_bytes {
                break;
            }
            if !file.exists() {
                continue;
            }
            let rel = file
                .strip_prefix(root)
                .unwrap_or(file)
                .display()
                .to_string();
            if !included_files.insert(rel.clone()) {
                continue;
            }

            if let Ok(content) = std::fs::read_to_string(file) {
                let section = format!("--- {} ---\n{}\n\n", rel, content);
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
        }

        let src_dir = crate_dir.join("src");
        if src_dir.is_dir() {
            collect_rs_files_recursive(
                root,
                &src_dir,
                &mut output,
                &mut current_size,
                max_bytes,
                &mut included_files,
            )?;
        }
    }

    // Tier 2: Dependency crates' lib.rs (signatures only)
    let dep_crate_paths: Vec<String> = target_crates
        .iter()
        .flat_map(|tc| crate_internal_deps.get(tc).cloned().unwrap_or_default())
        .filter_map(|dep_name| name_to_path.get(&dep_name).cloned())
        .collect();

    for dep_path in &dep_crate_paths {
        if current_size >= max_bytes {
            break;
        }
        let lib_rs = root.join(dep_path).join("src").join("lib.rs");
        if !lib_rs.exists() {
            continue;
        }
        let rel = lib_rs
            .strip_prefix(root)
            .unwrap_or(&lib_rs)
            .display()
            .to_string();
        if !included_files.insert(rel.clone()) {
            continue;
        }

        match read_signatures_only(&lib_rs) {
            Ok(sigs) if !sigs.is_empty() => {
                let section = format!("--- {} [signatures] ---\n{}\n\n", rel, sigs);
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
            _ => {}
        }
    }

    // Tier 3: Files matching keyword patterns from the task description
    if current_size < max_bytes && !keywords.is_empty() {
        let mut keyword_matches: Vec<(String, std::path::PathBuf)> = Vec::new();
        collect_keyword_matching_files(root, root, &keywords, &mut keyword_matches, &included_files);
        keyword_matches.sort_by(|a, b| a.0.cmp(&b.0));

        for (rel, full) in keyword_matches {
            if current_size >= max_bytes {
                break;
            }
            if !included_files.insert(rel.clone()) {
                continue;
            }

            if let Ok(content) = std::fs::read_to_string(&full) {
                let section = if content.len() > 8_000 && rel.ends_with(".rs") {
                    let sigs = extract_signatures_from_content(&content);
                    if sigs.len() < content.len() / 2 && !sigs.is_empty() {
                        format!("--- {} [signatures] ---\n{}\n\n", rel, sigs)
                    } else {
                        format!("--- {} ---\n{}\n\n", rel, content)
                    }
                } else {
                    format!("--- {} ---\n{}\n\n", rel, content)
                };

                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
        }
    }

    // Tier 4: Remaining workspace files alphabetically (existing behavior)
    if current_size < max_bytes {
        walk_and_collect_filtered(
            root,
            root,
            &mut output,
            &mut current_size,
            max_bytes,
            &mut included_files,
        )?;
    }

    Ok(output)
}

/// Collect all .rs files in a directory recursively, reading full content.
fn collect_rs_files_recursive(
    base: &Path,
    dir: &Path,
    output: &mut String,
    current_size: &mut usize,
    max_bytes: usize,
    included: &mut std::collections::HashSet<String>,
) -> Result<(), EngineError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if *current_size >= max_bytes {
            break;
        }
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&fname.as_str()) {
                continue;
            }
            collect_rs_files_recursive(base, &path, output, current_size, max_bytes, included)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .display()
                .to_string();
            if !included.insert(rel.clone()) {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                let section = format!("--- {} ---\n{}\n\n", rel, content);
                if *current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    *current_size += section.len();
                }
            }
        }
    }
    Ok(())
}

/// Walk the filesystem looking for files whose path or content matches any of
/// the given keywords.  Only matches filenames, not content (to stay fast).
fn collect_keyword_matching_files(
    base: &Path,
    dir: &Path,
    keywords: &[String],
    results: &mut Vec<(String, std::path::PathBuf)>,
    already_included: &std::collections::HashSet<String>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&fname.as_str()) {
                continue;
            }
            collect_keyword_matching_files(base, &path, keywords, results, already_included);
        } else if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default();
            if !INCLUDE_EXTENSIONS.contains(&ext) {
                continue;
            }

            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .display()
                .to_string();
            if already_included.contains(&rel) {
                continue;
            }

            let fname_lower = fname.to_lowercase();
            let matches = keywords.iter().any(|kw| {
                let kw_lower = kw.to_lowercase();
                fname_lower.contains(&kw_lower)
                    || kw_lower.contains(&fname_lower.trim_end_matches(".rs"))
            });
            if matches {
                results.push((rel, path));
            }
        }
    }
}

/// Like `walk_and_collect` but skips already-included files.
fn walk_and_collect_filtered(
    base: &Path,
    dir: &Path,
    output: &mut String,
    current_size: &mut usize,
    max_bytes: usize,
    included: &mut std::collections::HashSet<String>,
) -> Result<(), EngineError> {
    let entries = std::fs::read_dir(dir).map_err(|e| EngineError::Io(e.to_string()))?;
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        if *current_size >= max_bytes {
            break;
        }
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if SKIP_DIRS.contains(&file_name.as_str()) {
                continue;
            }
            walk_and_collect_filtered(base, &path, output, current_size, max_bytes, included)?;
        } else if path.is_file() {
            let extension = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default();
            if !INCLUDE_EXTENSIONS.contains(&extension) {
                continue;
            }

            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .display()
                .to_string();
            if !included.insert(rel.clone()) {
                continue;
            }

            let content =
                std::fs::read_to_string(&path).map_err(|e| EngineError::Io(e.to_string()))?;
            let section = format!("--- {} ---\n{}\n\n", rel, content);
            if *current_size + section.len() > max_bytes {
                break;
            }
            output.push_str(&section);
            *current_size += section.len();
        }
    }
    Ok(())
}

/// Resolve the public API surface of a target crate's workspace dependencies
/// (and their transitive dependencies up to `max_depth`).  For each dependency,
/// reads `lib.rs` in signature-only mode.  Returns a formatted context block
/// suitable for prompt injection.
pub fn resolve_crate_api_context(
    project_root: &str,
    target_crate: &str,
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

    let target_path = if members.contains(&target_crate.to_string()) {
        target_crate.to_string()
    } else if let Some(path) = name_to_path.get(target_crate) {
        path.clone()
    } else {
        return Ok(String::new());
    };

    const MAX_DEPTH: usize = 2;
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    visited.insert(target_path.clone());

    let mut queue: Vec<(String, usize)> = Vec::new();
    if let Some(deps) = crate_deps.get(&target_path) {
        for dep_name in deps {
            if let Some(dep_path) = name_to_path.get(dep_name) {
                if visited.insert(dep_path.clone()) {
                    queue.push((dep_path.clone(), 1));
                }
            }
        }
    }

    let mut output = String::new();
    let mut remaining = max_bytes;
    let mut idx = 0;

    while idx < queue.len() {
        if remaining == 0 {
            break;
        }
        let (member_path, depth) = queue[idx].clone();
        idx += 1;

        let crate_name = crate_names
            .get(&member_path)
            .cloned()
            .unwrap_or_else(|| member_path.clone());
        let target_name = crate_names
            .get(&target_path)
            .cloned()
            .unwrap_or_else(|| target_path.clone());

        let lib_rs = root.join(&member_path).join("src").join("lib.rs");
        if !lib_rs.exists() {
            continue;
        }

        let sigs = match read_signatures_only(&lib_rs) {
            Ok(s) if !s.is_empty() => s,
            _ => continue,
        };

        let section = format!(
            "# API Surface: {} (dependency of {})\n{}\n\n",
            crate_name, target_name, sigs,
        );

        if section.len() > remaining {
            continue;
        }
        output.push_str(&section);
        remaining = remaining.saturating_sub(section.len());

        if depth < MAX_DEPTH {
            if let Some(transitive_deps) = crate_deps.get(&member_path) {
                for dep_name in transitive_deps {
                    if let Some(dep_path) = name_to_path.get(dep_name) {
                        if visited.insert(dep_path.clone()) {
                            queue.push((dep_path.clone(), depth + 1));
                        }
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Convenience wrapper: identify target crates from a task's title and
/// description, then resolve the API surface of their transitive dependencies.
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

    let targets =
        identify_target_crates(task_title, task_description, &members, &crate_names);
    if targets.is_empty() {
        return Ok(String::new());
    }

    let mut output = String::new();
    let mut remaining = max_bytes;

    for target in &targets {
        if remaining == 0 {
            break;
        }
        let section = resolve_crate_api_context(project_root, target, remaining)?;
        if !section.is_empty() {
            remaining = remaining.saturating_sub(section.len());
            output.push_str(&section);
        }
    }

    Ok(output)
}

/// Like `retrieve_task_relevant_files` but uses a pre-built `WorkspaceCache`
/// to avoid re-parsing Cargo.toml files on every task iteration.
/// Runs the FS walk on a blocking thread to avoid stalling the tokio runtime.
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

    let mut output = String::new();
    let mut current_size: usize = 0;
    let mut included_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    for target in &target_crates {
        if current_size >= max_bytes { break; }
        let crate_dir = root.join(target);
        let core_files = [
            crate_dir.join("Cargo.toml"),
            crate_dir.join("src").join("lib.rs"),
            crate_dir.join("src").join("main.rs"),
            crate_dir.join("src").join("mod.rs"),
        ];
        for file in &core_files {
            if current_size >= max_bytes { break; }
            if !file.exists() { continue; }
            let rel = file.strip_prefix(root).unwrap_or(file).display().to_string();
            if !included_files.insert(rel.clone()) { continue; }
            if let Ok(content) = std::fs::read_to_string(file) {
                let section = format!("--- {} ---\n{}\n\n", rel, content);
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
        }
        let src_dir = crate_dir.join("src");
        if src_dir.is_dir() {
            collect_rs_files_recursive(
                root, &src_dir, &mut output, &mut current_size,
                max_bytes, &mut included_files,
            )?;
        }
    }

    let dep_crate_paths: Vec<String> = target_crates
        .iter()
        .flat_map(|tc| cache.crate_deps.get(tc).cloned().unwrap_or_default())
        .filter_map(|dep_name| cache.name_to_path.get(&dep_name).cloned())
        .collect();

    for dep_path in &dep_crate_paths {
        if current_size >= max_bytes { break; }
        let lib_rs = root.join(dep_path).join("src").join("lib.rs");
        if !lib_rs.exists() { continue; }
        let rel = lib_rs.strip_prefix(root).unwrap_or(&lib_rs).display().to_string();
        if !included_files.insert(rel.clone()) { continue; }
        match read_signatures_only(&lib_rs) {
            Ok(sigs) if !sigs.is_empty() => {
                let section = format!("--- {} [signatures] ---\n{}\n\n", rel, sigs);
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
            _ => {}
        }
    }

    if current_size < max_bytes && !keywords.is_empty() {
        let mut keyword_matches: Vec<(String, std::path::PathBuf)> = Vec::new();
        collect_keyword_matching_files(root, root, &keywords, &mut keyword_matches, &included_files);
        keyword_matches.sort_by(|a, b| a.0.cmp(&b.0));
        for (rel, full) in keyword_matches {
            if current_size >= max_bytes { break; }
            if !included_files.insert(rel.clone()) { continue; }
            if let Ok(content) = std::fs::read_to_string(&full) {
                let section = if content.len() > 8_000 && rel.ends_with(".rs") {
                    let sigs = extract_signatures_from_content(&content);
                    if sigs.len() < content.len() / 2 && !sigs.is_empty() {
                        format!("--- {} [signatures] ---\n{}\n\n", rel, sigs)
                    } else {
                        format!("--- {} ---\n{}\n\n", rel, content)
                    }
                } else {
                    format!("--- {} ---\n{}\n\n", rel, content)
                };
                if current_size + section.len() <= max_bytes {
                    output.push_str(&section);
                    current_size += section.len();
                }
            }
        }
    }

    if current_size < max_bytes {
        walk_and_collect_filtered(
            root, root, &mut output, &mut current_size, max_bytes, &mut included_files,
        )?;
    }

    Ok(output)
}

/// Like `resolve_task_dep_api_context` but uses a pre-built `WorkspaceCache`.
/// Runs the FS reads on a blocking thread to avoid stalling the tokio runtime.
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

        const MAX_DEPTH: usize = 2;
        let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
        visited.insert(target_path.clone());

        let mut queue: Vec<(String, usize)> = Vec::new();
        if let Some(deps) = cache.crate_deps.get(&target_path) {
            for dep_name in deps {
                if let Some(dep_path) = cache.name_to_path.get(dep_name) {
                    if visited.insert(dep_path.clone()) {
                        queue.push((dep_path.clone(), 1));
                    }
                }
            }
        }

        let mut idx = 0;
        while idx < queue.len() {
            if remaining == 0 { break; }
            let (member_path, depth) = queue[idx].clone();
            idx += 1;

            let crate_name = cache.crate_names
                .get(&member_path)
                .cloned()
                .unwrap_or_else(|| member_path.clone());
            let target_name = cache.crate_names
                .get(&target_path)
                .cloned()
                .unwrap_or_else(|| target_path.clone());

            let lib_rs = root.join(&member_path).join("src").join("lib.rs");
            if !lib_rs.exists() { continue; }

            let sigs = match read_signatures_only(&lib_rs) {
                Ok(s) if !s.is_empty() => s,
                _ => continue,
            };

            let section = format!(
                "# API Surface: {} (dependency of {})\n{}\n\n",
                crate_name, target_name, sigs,
            );

            if section.len() > remaining { continue; }
            output.push_str(&section);
            remaining = remaining.saturating_sub(section.len());

            if depth < MAX_DEPTH {
                if let Some(transitive_deps) = cache.crate_deps.get(&member_path) {
                    for dep_name in transitive_deps {
                        if let Some(dep_path) = cache.name_to_path.get(dep_name) {
                            if visited.insert(dep_path.clone()) {
                                queue.push((dep_path.clone(), depth + 1));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Check whether a line is an `impl` block header for the given type name.
/// Handles `impl Type`, `impl<T> Type<T>`, `impl Trait for Type`, etc.
pub(crate) fn is_impl_for_type(line: &str, type_name: &str) -> bool {
    if !line.starts_with("impl") {
        return false;
    }
    if line.len() > 4 {
        let fifth = line.as_bytes()[4];
        if fifth.is_ascii_alphanumeric() || fifth == b'_' {
            return false;
        }
    }

    let bytes = line.as_bytes();
    let tn_bytes = type_name.as_bytes();
    let tn_len = tn_bytes.len();

    let mut i = 4;
    while i + tn_len <= bytes.len() {
        if &bytes[i..i + tn_len] == tn_bytes {
            let before_ok =
                i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
            let after_ok = i + tn_len >= bytes.len()
                || !(bytes[i + tn_len].is_ascii_alphanumeric() || bytes[i + tn_len] == b'_');
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}
