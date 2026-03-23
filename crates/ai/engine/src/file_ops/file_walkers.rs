use std::path::Path;

use super::workspace_map::{extract_signatures_from_content, read_signatures_only};
use super::{INCLUDE_EXTENSIONS, SKIP_DIRS};
use crate::error::EngineError;

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
                    || kw_lower.contains(fname_lower.trim_end_matches(".rs"))
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

struct TieredCollector<'a> {
    root: &'a Path,
    output: String,
    current_size: usize,
    max_bytes: usize,
    included: std::collections::HashSet<String>,
}

impl<'a> TieredCollector<'a> {
    fn new(root: &'a Path, max_bytes: usize) -> Self {
        Self {
            root,
            output: String::new(),
            current_size: 0,
            max_bytes,
            included: std::collections::HashSet::new(),
        }
    }

    fn budget_exhausted(&self) -> bool {
        self.current_size >= self.max_bytes
    }

    fn try_append(&mut self, rel: String, section: &str) {
        if self.included.insert(rel) && self.current_size + section.len() <= self.max_bytes {
            self.output.push_str(section);
            self.current_size += section.len();
        }
    }

    fn collect_target_crates(&mut self, target_crates: &[String]) -> Result<(), EngineError> {
        for target in target_crates {
            if self.budget_exhausted() {
                break;
            }
            let crate_dir = self.root.join(target);
            for file in &[
                crate_dir.join("Cargo.toml"),
                crate_dir.join("src/lib.rs"),
                crate_dir.join("src/main.rs"),
                crate_dir.join("src/mod.rs"),
            ] {
                if self.budget_exhausted() || !file.exists() {
                    continue;
                }
                let rel = file
                    .strip_prefix(self.root)
                    .unwrap_or(file)
                    .display()
                    .to_string();
                if let Ok(content) = std::fs::read_to_string(file) {
                    self.try_append(rel.clone(), &format!("--- {rel} ---\n{content}\n\n"));
                }
            }
            let src_dir = crate_dir.join("src");
            if src_dir.is_dir() {
                collect_rs_files_recursive(
                    self.root,
                    &src_dir,
                    &mut self.output,
                    &mut self.current_size,
                    self.max_bytes,
                    &mut self.included,
                )?;
            }
        }
        Ok(())
    }

    fn collect_dep_signatures(&mut self, dep_crate_paths: &[String]) {
        for dep_path in dep_crate_paths {
            if self.budget_exhausted() {
                break;
            }
            let lib_rs = self.root.join(dep_path).join("src").join("lib.rs");
            if !lib_rs.exists() {
                continue;
            }
            let rel = lib_rs
                .strip_prefix(self.root)
                .unwrap_or(&lib_rs)
                .display()
                .to_string();
            if let Ok(sigs) = read_signatures_only(&lib_rs) {
                if !sigs.is_empty() {
                    self.try_append(
                        rel.clone(),
                        &format!("--- {rel} [signatures] ---\n{sigs}\n\n"),
                    );
                }
            }
        }
    }

    fn collect_keyword_files(&mut self, keywords: &[String]) {
        if self.budget_exhausted() || keywords.is_empty() {
            return;
        }
        let mut matches: Vec<(String, std::path::PathBuf)> = Vec::new();
        collect_keyword_matching_files(
            self.root,
            self.root,
            keywords,
            &mut matches,
            &self.included,
        );
        matches.sort_by(|a, b| a.0.cmp(&b.0));
        for (rel, full) in matches {
            if self.budget_exhausted() {
                break;
            }
            if let Ok(content) = std::fs::read_to_string(&full) {
                let section = format_file_or_signatures(&rel, &content);
                self.try_append(rel, &section);
            }
        }
    }
}

fn format_file_or_signatures(rel: &str, content: &str) -> String {
    if content.len() > 8_000 && rel.ends_with(".rs") {
        let sigs = extract_signatures_from_content(content);
        if sigs.len() < content.len() / 2 && !sigs.is_empty() {
            return format!("--- {rel} [signatures] ---\n{sigs}\n\n");
        }
    }
    format!("--- {rel} ---\n{content}\n\n")
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
    let mut tc = TieredCollector::new(root, max_bytes);
    tc.collect_target_crates(target_crates)?;
    tc.collect_dep_signatures(dep_crate_paths);
    tc.collect_keyword_files(keywords);
    if !tc.budget_exhausted() {
        walk_and_collect_filtered(
            root,
            root,
            &mut tc.output,
            &mut tc.current_size,
            max_bytes,
            &mut tc.included,
        )?;
    }
    Ok(tc.output)
}

fn seed_bfs_queue(
    target_path: &str,
    crate_deps: &std::collections::HashMap<String, Vec<String>>,
    name_to_path: &std::collections::HashMap<String, String>,
    visited: &mut std::collections::HashSet<String>,
) -> Vec<(String, usize)> {
    let mut queue = Vec::new();
    if let Some(deps) = crate_deps.get(target_path) {
        for dep_name in deps {
            if let Some(dep_path) = name_to_path.get(dep_name) {
                if visited.insert(dep_path.clone()) {
                    queue.push((dep_path.clone(), 1));
                }
            }
        }
    }
    queue
}

fn enqueue_transitive_deps(
    queue: &mut Vec<(String, usize)>,
    member_path: &str,
    depth: usize,
    max_depth: usize,
    crate_deps: &std::collections::HashMap<String, Vec<String>>,
    name_to_path: &std::collections::HashMap<String, String>,
    visited: &mut std::collections::HashSet<String>,
) {
    if depth >= max_depth {
        return;
    }
    if let Some(transitive_deps) = crate_deps.get(member_path) {
        for dep_name in transitive_deps {
            if let Some(dep_path) = name_to_path.get(dep_name) {
                if visited.insert(dep_path.clone()) {
                    queue.push((dep_path.clone(), depth + 1));
                }
            }
        }
    }
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
    let mut queue = seed_bfs_queue(target_path, crate_deps, name_to_path, &mut visited);

    let target_name = crate_names
        .get(target_path)
        .cloned()
        .unwrap_or_else(|| target_path.to_string());
    let mut output = String::new();
    let mut remaining = max_bytes;
    let mut idx = 0;

    while idx < queue.len() && remaining > 0 {
        let (member_path, depth) = queue[idx].clone();
        idx += 1;
        let crate_name = crate_names
            .get(&member_path)
            .cloned()
            .unwrap_or_else(|| member_path.clone());
        let lib_rs = root.join(&member_path).join("src").join("lib.rs");
        if !lib_rs.exists() {
            continue;
        }
        let sigs = match read_signatures_only(&lib_rs) {
            Ok(s) if !s.is_empty() => s,
            _ => continue,
        };
        let section =
            format!("# API Surface: {crate_name} (dependency of {target_name})\n{sigs}\n\n");
        if section.len() > remaining {
            continue;
        }
        output.push_str(&section);
        remaining = remaining.saturating_sub(section.len());
        enqueue_transitive_deps(
            &mut queue,
            &member_path,
            depth,
            MAX_DEPTH,
            crate_deps,
            name_to_path,
            &mut visited,
        );
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn make_temp_project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("lib.rs"), "pub fn hello() {}").unwrap();
        std::fs::write(dir.path().join("readme.txt"), "not included").unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git").join("config"), "git stuff").unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src").join("utils.rs"), "pub fn util() {}").unwrap();
        std::fs::write(
            dir.path().join("src").join("helper.ts"),
            "export function helper() {}",
        )
        .unwrap();
        dir
    }

    #[test]
    fn test_walk_and_collect_filtered_skips_gitdir() {
        let dir = make_temp_project();
        let mut output = String::new();
        let mut size = 0;
        let mut included = HashSet::new();
        walk_and_collect_filtered(
            dir.path(),
            dir.path(),
            &mut output,
            &mut size,
            100_000,
            &mut included,
        )
        .unwrap();
        assert!(
            !output.contains("git stuff"),
            ".git/ contents should be skipped"
        );
        assert!(!included.iter().any(|f| f.contains(".git")));
    }

    #[test]
    fn test_walk_and_collect_filtered_respects_extensions() {
        let dir = make_temp_project();
        let mut output = String::new();
        let mut size = 0;
        let mut included = HashSet::new();
        walk_and_collect_filtered(
            dir.path(),
            dir.path(),
            &mut output,
            &mut size,
            100_000,
            &mut included,
        )
        .unwrap();
        assert!(output.contains("main.rs"), "should include .rs files");
        assert!(
            !output.contains("not included"),
            "should not include .txt files"
        );
    }

    #[test]
    fn test_walk_and_collect_filtered_respects_size_limit() {
        let dir = make_temp_project();
        let mut output = String::new();
        let mut size = 0;
        let mut included = HashSet::new();
        walk_and_collect_filtered(
            dir.path(),
            dir.path(),
            &mut output,
            &mut size,
            50,
            &mut included,
        )
        .unwrap();
        assert!(
            output.len() <= 100,
            "output should be limited by max_bytes (with some tolerance for one section)"
        );
    }

    #[test]
    fn test_walk_and_collect_filtered_dedup_via_included() {
        let dir = make_temp_project();
        let mut output = String::new();
        let mut size = 0;
        let mut included = HashSet::new();
        included.insert("main.rs".to_string());
        walk_and_collect_filtered(
            dir.path(),
            dir.path(),
            &mut output,
            &mut size,
            100_000,
            &mut included,
        )
        .unwrap();
        assert!(
            !output.contains("fn main()"),
            "pre-included files should be skipped"
        );
    }

    #[test]
    fn test_format_file_or_signatures_short_file() {
        let content = "fn short() {}";
        let result = format_file_or_signatures("short.rs", content);
        assert!(
            result.contains("fn short() {}"),
            "short file should include full content"
        );
        assert!(result.contains("--- short.rs ---"));
        assert!(!result.contains("[signatures]"));
    }

    #[test]
    fn test_format_file_or_signatures_long_file() {
        let content = (0..500)
            .map(|i| format!("fn func_{i}() {{ /* body */ }}\n"))
            .collect::<String>();
        assert!(content.len() > 8_000);
        let result = format_file_or_signatures("long.rs", &content);
        assert!(result.contains("long.rs"));
    }

    #[test]
    fn test_collect_keyword_matching_files_finds_matches() {
        let dir = make_temp_project();
        let mut results = Vec::new();
        let included = HashSet::new();
        collect_keyword_matching_files(
            dir.path(),
            dir.path(),
            &["utils".to_string()],
            &mut results,
            &included,
        );
        let paths: Vec<&str> = results.iter().map(|(r, _)| r.as_str()).collect();
        assert!(
            paths.iter().any(|p| p.contains("utils")),
            "should find utils.rs"
        );
    }

    #[test]
    fn test_collect_keyword_matching_files_skips_non_matching() {
        let dir = make_temp_project();
        let mut results = Vec::new();
        let included = HashSet::new();
        collect_keyword_matching_files(
            dir.path(),
            dir.path(),
            &["nonexistent".to_string()],
            &mut results,
            &included,
        );
        assert!(results.is_empty(), "no files should match 'nonexistent'");
    }

    #[test]
    fn test_tiered_collector_budget_exhaustion() {
        let dir = make_temp_project();
        let tc = TieredCollector::new(dir.path(), 0);
        assert!(
            tc.budget_exhausted(),
            "zero budget should be immediately exhausted"
        );
        let tc2 = TieredCollector::new(dir.path(), 100_000);
        assert!(
            !tc2.budget_exhausted(),
            "large budget should not be exhausted"
        );
    }
}
