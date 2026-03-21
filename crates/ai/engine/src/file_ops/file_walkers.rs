use std::path::Path;

use crate::error::EngineError;
use super::{INCLUDE_EXTENSIONS, SKIP_DIRS};
use super::workspace_map::{extract_signatures_from_content, read_signatures_only};

/// Collect all .rs files in a directory recursively, reading full content.
pub(crate) fn collect_rs_files_recursive(
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

/// Walk the filesystem looking for files whose filename matches any keyword.
pub(crate) fn collect_keyword_matching_files(
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
pub(crate) fn walk_and_collect_filtered(
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

/// Shared 4-tier file collection logic used by both the sync and cached variants
/// of `retrieve_task_relevant_files`.
pub(crate) fn collect_tiered_files(
    root: &Path,
    target_crates: &[String],
    dep_crate_paths: &[String],
    keywords: &[String],
    max_bytes: usize,
) -> Result<String, EngineError> {
    let mut output = String::new();
    let mut current_size: usize = 0;
    let mut included_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Tier 1: Target crate core files + all .rs files
    for target in target_crates {
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

    // Tier 2: Dependency crates' lib.rs (signatures only)
    for dep_path in dep_crate_paths {
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

    // Tier 3: Files matching keyword patterns
    if current_size < max_bytes && !keywords.is_empty() {
        let mut keyword_matches: Vec<(String, std::path::PathBuf)> = Vec::new();
        collect_keyword_matching_files(root, root, keywords, &mut keyword_matches, &included_files);
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

    // Tier 4: Remaining workspace files
    if current_size < max_bytes {
        walk_and_collect_filtered(
            root, root, &mut output, &mut current_size, max_bytes, &mut included_files,
        )?;
    }

    Ok(output)
}

/// Shared BFS dependency resolution used by both sync and cached API context functions.
pub(crate) fn resolve_dependency_signatures_bfs(
    root: &Path,
    target_path: &str,
    crate_names: &std::collections::HashMap<String, String>,
    crate_deps: &std::collections::HashMap<String, Vec<String>>,
    name_to_path: &std::collections::HashMap<String, String>,
    max_bytes: usize,
) -> String {
    const MAX_DEPTH: usize = 2;
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    visited.insert(target_path.to_string());

    let mut queue: Vec<(String, usize)> = Vec::new();
    if let Some(deps) = crate_deps.get(target_path) {
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

    let target_name = crate_names
        .get(target_path)
        .cloned()
        .unwrap_or_else(|| target_path.to_string());

    while idx < queue.len() {
        if remaining == 0 { break; }
        let (member_path, depth) = queue[idx].clone();
        idx += 1;

        let crate_name = crate_names
            .get(&member_path)
            .cloned()
            .unwrap_or_else(|| member_path.clone());

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

    output
}
