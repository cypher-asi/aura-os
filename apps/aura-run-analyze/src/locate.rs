//! Resolve a bundle directory from CLI arguments + environment.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use aura_loop_log_schema::RunMetadata;

use crate::cli::Cli;

/// Decide which base directory holds bundles. Explicit CLI override
/// wins; otherwise check `$AURA_LOOP_LOGS_DIR`; finally fall back to
/// `./loop_logs` (matching the server's built-in default).
pub fn loop_logs_dir(explicit: Option<&Path>) -> PathBuf {
    if let Some(p) = explicit {
        return p.to_path_buf();
    }
    if let Ok(val) = env::var("AURA_LOOP_LOGS_DIR") {
        if !val.is_empty() {
            return PathBuf::from(val);
        }
    }
    PathBuf::from("./loop_logs")
}

/// Turn CLI flags into an absolute path to a single run bundle
/// directory. `--list` mode is handled by the caller directly.
pub fn resolve_bundle_dir(cli: &Cli) -> Result<PathBuf> {
    if let Some(path) = cli.bundle.as_ref() {
        if !path.is_dir() {
            bail!("bundle path {} is not a directory", path.display());
        }
        return Ok(path.clone());
    }

    let project = cli
        .project
        .as_deref()
        .ok_or_else(|| anyhow!("expected a bundle path or --project"))?;
    let base = loop_logs_dir(cli.loop_logs_dir.as_deref());
    let project_dir = base.join(project);
    if !project_dir.is_dir() {
        bail!(
            "no such project directory: {}",
            project_dir.display()
        );
    }

    if let Some(run_id) = cli.run.as_deref() {
        let run_dir = project_dir.join(run_id);
        if !run_dir.is_dir() {
            bail!("no such run directory: {}", run_dir.display());
        }
        return Ok(run_dir);
    }
    if cli.latest {
        return latest_run_dir(&project_dir)
            .with_context(|| format!("finding latest run under {}", project_dir.display()));
    }
    bail!("use --latest or --run <id> to pick a run under --project");
}

fn latest_run_dir(project_dir: &Path) -> Result<PathBuf> {
    let mut best: Option<(PathBuf, chrono::DateTime<chrono::Utc>)> = None;
    for entry in fs::read_dir(project_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let meta_path = path.join("metadata.json");
        let Ok(bytes) = fs::read(&meta_path) else {
            continue;
        };
        let Ok(metadata) = serde_json::from_slice::<RunMetadata>(&bytes) else {
            continue;
        };
        match best {
            None => best = Some((path, metadata.started_at)),
            Some((_, ts)) if metadata.started_at > ts => best = Some((path, metadata.started_at)),
            _ => {}
        }
    }
    best.map(|(p, _)| p)
        .ok_or_else(|| anyhow!("no usable run bundles found"))
}
