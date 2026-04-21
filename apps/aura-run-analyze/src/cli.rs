use std::path::PathBuf;

use aura_run_heuristics::Severity;
use clap::{Parser, ValueEnum};

/// CLI wrapper around the heuristic analyzer. See the `main.rs`
/// doc comment for the full synopsis.
#[derive(Debug, Parser)]
#[command(
    name = "aura-run-analyze",
    version,
    about = "Analyze a dev-loop run bundle and surface issues."
)]
pub struct Cli {
    /// Path to a run bundle directory. Mutually exclusive with
    /// `--project` / `--list`.
    #[arg(conflicts_with_all = ["project", "list", "latest", "run"])]
    pub bundle: Option<PathBuf>,

    /// Scope project-mode lookups. Required when using `--latest`
    /// or `--run`.
    #[arg(long)]
    pub project: Option<String>,

    /// Pick the most recently started run in the project.
    #[arg(long, requires = "project", conflicts_with = "run")]
    pub latest: bool,

    /// Pick a specific run id under the given project.
    #[arg(long, requires = "project")]
    pub run: Option<String>,

    /// Print a project → run_id tree, then exit.
    #[arg(long, conflicts_with_all = ["project", "latest", "run"])]
    pub list: bool,

    /// Base directory holding `<project_id>/<run_id>` bundles.
    /// Falls back to `$AURA_LOOP_LOGS_DIR`, then `./loop_logs`.
    #[arg(long)]
    pub loop_logs_dir: Option<PathBuf>,

    /// Output format.
    #[arg(long, value_enum, default_value_t = Format::Markdown)]
    pub format: Format,

    /// Minimum severity threshold — findings below this are dropped
    /// before rendering, but still count against the process exit
    /// code calculation.
    #[arg(long, value_enum, default_value_t = SeverityArg::Info)]
    pub min_severity: SeverityArg,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Format {
    Markdown,
    Json,
}

/// Clap wrapper around `Severity` (clap's `ValueEnum` macro can't
/// derive on types from a downstream crate).
#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum SeverityArg {
    Info,
    Warn,
    Error,
}

impl From<SeverityArg> for Severity {
    fn from(value: SeverityArg) -> Self {
        match value {
            SeverityArg::Info => Severity::Info,
            SeverityArg::Warn => Severity::Warn,
            SeverityArg::Error => Severity::Error,
        }
    }
}

impl Cli {
    /// Convenience: the `min_severity` field as the core enum.
    pub fn min_severity(&self) -> Severity {
        Severity::from(self.min_severity)
    }
}
