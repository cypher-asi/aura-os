use std::path::Path;

use serde::{Deserialize, Serialize};
use crate::error::EngineError;

mod apply;
pub(crate) mod error_context;
pub(crate) mod source_parser;
pub mod stub_detection;
pub mod task_relevance;
pub mod task_keywords;
pub mod file_walkers;
pub mod type_resolution;
pub mod validation;
pub mod workspace_map;

pub use apply::{apply_file_ops, compute_file_changes};
pub use error_context::{resolve_error_context, resolve_error_source_files, ERROR_SOURCE_BUDGET};
pub(crate) use source_parser::{extract_pub_signatures, extract_definition_block};
pub use stub_detection::*;
pub use task_relevance::*;
pub use validation::*;
pub use workspace_map::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Replacement {
    pub search: String,
    pub replace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FileOp {
    Create { path: String, content: String },
    Modify { path: String, content: String },
    Delete { path: String },
    SearchReplace {
        path: String,
        replacements: Vec<Replacement>,
    },
}

pub fn validate_path(base: &Path, target: &Path) -> Result<(), EngineError> {
    let norm_base = lexical_normalize(base);
    let norm_target = lexical_normalize(target);

    if !norm_target.starts_with(&norm_base) {
        return Err(EngineError::PathEscape(target.display().to_string()));
    }
    Ok(())
}

/// Resolve `.` and `..` components without hitting the filesystem, avoiding
/// Windows `\\?\` extended-path issues that `canonicalize()` introduces.
fn lexical_normalize(path: &Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

pub(crate) const SKIP_DIRS: &[&str] = &[
    ".git",
    "target",
    "node_modules",
    "__pycache__",
    ".venv",
    "dist",
];

/// References extracted from compiler error output for targeted context resolution.
#[derive(Debug, Default)]
pub struct ErrorReferences {
    pub types_referenced: Vec<String>,
    pub methods_not_found: Vec<(String, String)>,
    pub missing_fields: Vec<(String, String)>,
    pub source_locations: Vec<(String, u32)>,
    pub wrong_arg_counts: Vec<String>,
}

pub(crate) const INCLUDE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "json", "toml", "md", "css", "html", "yaml", "yml", "py",
    "sh", "sql", "graphql",
];

pub fn read_relevant_files(linked_folder: &str, max_bytes: usize) -> Result<String, EngineError> {
    let base = Path::new(linked_folder);
    let mut output = String::new();
    let mut current_size: usize = 0;
    walk_and_collect(base, base, &mut output, &mut current_size, max_bytes)?;
    Ok(output)
}

fn walk_and_collect(
    base: &Path,
    dir: &Path,
    output: &mut String,
    current_size: &mut usize,
    max_bytes: usize,
) -> Result<(), EngineError> {
    let mut included = std::collections::HashSet::new();
    file_walkers::walk_and_collect_filtered(base, dir, output, current_size, max_bytes, &mut included)
}
