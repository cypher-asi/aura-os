//! `aura-run-analyze` — CLI wrapper around `aura-run-heuristics`.
//!
//! Reads a dev-loop run bundle from disk, runs every heuristic rule,
//! and emits either markdown (for humans) or JSON (for CI).

use std::process::ExitCode;

use anyhow::Result;
use aura_run_heuristics::{analyze, load_bundle, Finding, Severity};
use clap::Parser;

mod cli;
mod locate;
mod render;

use cli::{Cli, Format};

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(err) => {
            eprintln!("error: {err:#}");
            ExitCode::from(3)
        }
    }
}

fn run() -> Result<ExitCode> {
    let cli = Cli::parse();
    if cli.list {
        let loop_logs_dir = locate::loop_logs_dir(cli.loop_logs_dir.as_deref());
        render::list_tree(&loop_logs_dir)?;
        return Ok(ExitCode::SUCCESS);
    }

    let bundle_dir = locate::resolve_bundle_dir(&cli)?;
    let bundle = load_bundle(&bundle_dir)?;
    let min_severity = cli.min_severity();
    let findings: Vec<Finding> = analyze(&bundle)
        .into_iter()
        .filter(|f| f.severity >= min_severity)
        .collect();

    match cli.format {
        Format::Markdown => render::markdown(&bundle, &findings, &bundle_dir)?,
        Format::Json => render::json(&bundle, &findings)?,
    }

    Ok(exit_code_for(&findings))
}

fn exit_code_for(findings: &[Finding]) -> ExitCode {
    let max = findings.iter().map(|f| f.severity).max();
    match max {
        Some(Severity::Error) => ExitCode::from(2),
        Some(Severity::Warn) => ExitCode::from(1),
        _ => ExitCode::SUCCESS,
    }
}
