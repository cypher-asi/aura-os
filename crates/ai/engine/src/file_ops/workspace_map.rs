use std::collections::HashMap;
use std::path::Path;

use crate::error::EngineError;

/// Parse the root `Cargo.toml` for `[workspace].members`, resolve each
/// member's internal dependencies, and produce a compact structural summary
/// (~2K tokens) suitable for prompt injection.
pub fn generate_workspace_map(project_root: &str) -> Result<String, EngineError> {
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
    let mut crate_docs: HashMap<String, String> = HashMap::new();

    for member in &members {
        let member_cargo = root.join(member).join("Cargo.toml");
        let content = match std::fs::read_to_string(&member_cargo) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
        let internal_deps = parse_internal_deps(&content);
        let doc = read_crate_doc_comment(root, member);

        crate_names.insert(member.clone(), name);
        crate_deps.insert(member.clone(), internal_deps);
        if !doc.is_empty() {
            crate_docs.insert(member.clone(), doc);
        }
    }

    let name_to_path: HashMap<&str, &str> = crate_names
        .iter()
        .map(|(path, name)| (name.as_str(), path.as_str()))
        .collect();

    let mut output = format!("Workspace: {} crates\n", members.len());
    for member in &members {
        let name = crate_names.get(member).map(|s| s.as_str()).unwrap_or(member);
        let doc = crate_docs.get(member).map(|s| s.as_str()).unwrap_or("");
        let doc_suffix = if doc.is_empty() {
            String::new()
        } else {
            format!(" -- {doc}")
        };
        output.push_str(&format!("  {member} ({name}){doc_suffix}\n"));

        if let Some(deps) = crate_deps.get(member) {
            let resolved: Vec<&str> = deps
                .iter()
                .filter_map(|d| {
                    if name_to_path.contains_key(d.as_str()) {
                        Some(d.as_str())
                    } else {
                        None
                    }
                })
                .collect();
            if resolved.is_empty() {
                output.push_str("    deps: []\n");
            } else {
                output.push_str(&format!("    deps: [{}]\n", resolved.join(", ")));
            }
        }
    }
    Ok(output)
}

pub(crate) fn parse_workspace_members(cargo_content: &str) -> Vec<String> {
    let mut members = Vec::new();
    let mut in_members = false;

    for line in cargo_content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("members") && trimmed.contains('[') {
            in_members = true;
            if trimmed.contains(']') {
                extract_quoted_strings(trimmed, &mut members);
                break;
            }
            extract_quoted_strings(trimmed, &mut members);
            continue;
        }
        if in_members {
            if trimmed.contains(']') {
                extract_quoted_strings(trimmed, &mut members);
                break;
            }
            extract_quoted_strings(trimmed, &mut members);
        }
    }
    members
}

fn extract_quoted_strings(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find('"') {
        rest = &rest[start + 1..];
        if let Some(end) = rest.find('"') {
            out.push(rest[..end].to_string());
            rest = &rest[end + 1..];
        } else {
            break;
        }
    }
}

pub(crate) fn parse_package_name(cargo_content: &str) -> Option<String> {
    let mut in_package = false;
    for line in cargo_content.lines() {
        let trimmed = line.trim();
        if trimmed == "[package]" {
            in_package = true;
            continue;
        }
        if trimmed.starts_with('[') && trimmed != "[package]" {
            if in_package {
                break;
            }
            continue;
        }
        if in_package && trimmed.starts_with("name") {
            if let Some(val) = trimmed.split('=').nth(1) {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Extract workspace-internal dependency names from a crate's Cargo.toml.
/// We detect path dependencies (those with `path = "..."`) and return
/// the package name (from `package = "..."` override or the dep key itself).
pub(crate) fn parse_internal_deps(cargo_content: &str) -> Vec<String> {
    let mut deps = Vec::new();
    let mut in_deps = false;
    let mut in_inline_table = false;
    let mut current_dep_name = String::new();

    for line in cargo_content.lines() {
        let trimmed = line.trim();

        if trimmed == "[dependencies]" || trimmed == "[dev-dependencies]" {
            in_deps = trimmed == "[dependencies]";
            in_inline_table = false;
            continue;
        }
        if trimmed.starts_with('[') {
            if trimmed.starts_with("[dependencies.") {
                let dep_name = trimmed
                    .trim_start_matches("[dependencies.")
                    .trim_end_matches(']');
                current_dep_name = dep_name.to_string();
                in_inline_table = true;
                in_deps = false;
                continue;
            }
            in_deps = false;
            in_inline_table = false;
            continue;
        }

        if in_inline_table {
            if trimmed.starts_with("path") {
                deps.push(current_dep_name.clone());
                in_inline_table = false;
            }
            continue;
        }

        if in_deps && trimmed.contains("path") && trimmed.contains('=') {
            let dep_name = trimmed.split('=').next().unwrap_or("").trim();
            if !dep_name.is_empty() {
                deps.push(dep_name.to_string());
            }
        }
    }
    deps
}

/// Read the first 5 lines of a crate's lib.rs or main.rs to extract
/// any `//!` module-level doc comment as a short description.
fn read_crate_doc_comment(project_root: &Path, member: &str) -> String {
    let src_dir = project_root.join(member).join("src");
    let entry_file = if src_dir.join("lib.rs").exists() {
        src_dir.join("lib.rs")
    } else if src_dir.join("main.rs").exists() {
        src_dir.join("main.rs")
    } else {
        return String::new();
    };

    let content = match std::fs::read_to_string(&entry_file) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let mut doc_parts = Vec::new();
    for line in content.lines().take(5) {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("//!") {
            doc_parts.push(stripped.trim().to_string());
        }
    }
    doc_parts.join(" ").trim().to_string()
}

/// Extract only public API signatures from a `.rs` file, dropping function
/// bodies. Delegates to `aura_core::rust_signatures::extract_signatures`.
pub fn read_signatures_only(file_path: &Path) -> Result<String, EngineError> {
    let content = std::fs::read_to_string(file_path)
        .map_err(|e| EngineError::Io(format!("failed to read {}: {e}", file_path.display())))?;
    Ok(extract_signatures_from_content(&content))
}

/// Re-export: extract public API signatures from Rust source content.
pub fn extract_signatures_from_content(content: &str) -> String {
    aura_core::rust_signatures::extract_signatures(content)
}

/// Pre-computed workspace metadata. Built once per loop run and reused across
/// all task iterations so that Cargo.toml files are parsed only once.
pub struct WorkspaceCache {
    pub members: Vec<String>,
    pub crate_names: HashMap<String, String>,
    pub crate_deps: HashMap<String, Vec<String>>,
    pub name_to_path: HashMap<String, String>,
    pub workspace_map_text: String,
    pub member_count: usize,
}

impl WorkspaceCache {
    pub fn build(project_root: &str) -> Result<Self, EngineError> {
        let root = Path::new(project_root);
        let root_cargo = root.join("Cargo.toml");
        let cargo_content = match std::fs::read_to_string(&root_cargo) {
            Ok(c) => c,
            Err(_) => return Ok(Self::empty()),
        };

        let members = parse_workspace_members(&cargo_content);
        if members.is_empty() {
            return Ok(Self::empty());
        }

        let mut crate_names: HashMap<String, String> = HashMap::new();
        let mut crate_deps: HashMap<String, Vec<String>> = HashMap::new();
        let mut crate_docs: HashMap<String, String> = HashMap::new();

        for member in &members {
            let member_cargo = root.join(member).join("Cargo.toml");
            let content = match std::fs::read_to_string(&member_cargo) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let name = parse_package_name(&content).unwrap_or_else(|| member.clone());
            let internal_deps = parse_internal_deps(&content);
            let doc = read_crate_doc_comment(root, member);
            crate_names.insert(member.clone(), name);
            crate_deps.insert(member.clone(), internal_deps);
            if !doc.is_empty() {
                crate_docs.insert(member.clone(), doc);
            }
        }

        let name_to_path: HashMap<String, String> = crate_names
            .iter()
            .map(|(path, name)| (name.clone(), path.clone()))
            .collect();

        let mut workspace_map_text = format!("Workspace: {} crates\n", members.len());
        for member in &members {
            let name = crate_names.get(member).map(|s| s.as_str()).unwrap_or(member);
            let doc = crate_docs.get(member).map(|s| s.as_str()).unwrap_or("");
            let doc_suffix = if doc.is_empty() {
                String::new()
            } else {
                format!(" -- {doc}")
            };
            workspace_map_text.push_str(&format!("  {member} ({name}){doc_suffix}\n"));

            if let Some(deps) = crate_deps.get(member) {
                let resolved: Vec<&str> = deps
                    .iter()
                    .filter(|d| name_to_path.contains_key(d.as_str()))
                    .map(|d| d.as_str())
                    .collect();
                if resolved.is_empty() {
                    workspace_map_text.push_str("    deps: []\n");
                } else {
                    workspace_map_text.push_str(&format!(
                        "    deps: [{}]\n",
                        resolved.join(", ")
                    ));
                }
            }
        }

        let member_count = members.len();
        Ok(Self { members, crate_names, crate_deps, name_to_path, workspace_map_text, member_count })
    }

    pub fn empty() -> Self {
        Self {
            members: Vec::new(),
            crate_names: HashMap::new(),
            crate_deps: HashMap::new(),
            name_to_path: HashMap::new(),
            workspace_map_text: String::new(),
            member_count: 1,
        }
    }
}

/// Count the number of workspace member crates by parsing the root Cargo.toml.
/// Returns 1 (single crate) if no workspace is detected.
pub fn count_workspace_members(project_root: &str) -> Result<usize, EngineError> {
    let root_cargo = Path::new(project_root).join("Cargo.toml");
    let content =
        std::fs::read_to_string(&root_cargo).map_err(|e| EngineError::Io(e.to_string()))?;
    let members = parse_workspace_members(&content);
    if members.is_empty() {
        Ok(1)
    } else {
        Ok(members.len())
    }
}
