//! Read APIs used by the HTTP surface and the `aura-run-analyze` CLI.
//! Pure filesystem reads — no in-memory state is consulted, so callers
//! always see what's on disk.

use std::collections::HashSet;
use std::path::Path;

use aura_os_core::ProjectId;
use tokio::fs;

use super::{LoopLogWriter, RunMetadata};

impl LoopLogWriter {
    /// List every run bundle for a single project, newest first.
    pub async fn list_runs(&self, project_id: ProjectId) -> Vec<RunMetadata> {
        let project_dir = self.base_dir.join(project_id.to_string());
        let mut entries = match fs::read_dir(&project_dir).await {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };
        let mut runs: Vec<RunMetadata> = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(meta) = read_metadata(&path).await {
                runs.push(meta);
            }
        }
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        runs
    }

    /// List every project id that has at least one run bundle on disk.
    pub async fn list_projects(&self) -> Vec<ProjectId> {
        let mut entries = match fs::read_dir(&self.base_dir).await {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };
        let mut seen: HashSet<ProjectId> = HashSet::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            if !entry.path().is_dir() {
                continue;
            }
            if let Some(name) = entry.file_name().to_str() {
                if let Ok(id) = name.parse::<ProjectId>() {
                    seen.insert(id);
                }
            }
        }
        seen.into_iter().collect()
    }

    pub async fn read_metadata(&self, project_id: ProjectId, run_id: &str) -> Option<RunMetadata> {
        let dir = self.bundle_dir(project_id, run_id);
        read_metadata(&dir).await
    }

    pub async fn read_jsonl(
        &self,
        project_id: ProjectId,
        run_id: &str,
        file_name: &str,
    ) -> Option<String> {
        let path = self.bundle_dir(project_id, run_id).join(file_name);
        fs::read_to_string(&path).await.ok()
    }

    pub async fn read_summary(&self, project_id: ProjectId, run_id: &str) -> Option<String> {
        let path = self.bundle_dir(project_id, run_id).join("summary.md");
        match fs::read_to_string(&path).await {
            Ok(content) => Some(content),
            Err(_) => {
                let metadata = self.read_metadata(project_id, run_id).await?;
                Some(render_summary(&metadata))
            }
        }
    }
}

pub(super) async fn read_metadata(run_dir: &Path) -> Option<RunMetadata> {
    let raw = fs::read(run_dir.join("metadata.json")).await.ok()?;
    serde_json::from_slice(&raw).ok()
}

pub(super) fn render_summary(metadata: &RunMetadata) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(out, "# Run {}", metadata.run_id);
    let _ = writeln!(out);
    let _ = writeln!(out, "- project_id: `{}`", metadata.project_id);
    let _ = writeln!(out, "- agent_instance_id: `{}`", metadata.agent_instance_id);
    let _ = writeln!(out, "- started_at: {}", metadata.started_at.to_rfc3339());
    if let Some(ended) = metadata.ended_at {
        let duration = ended.signed_duration_since(metadata.started_at);
        let _ = writeln!(out, "- ended_at: {}", ended.to_rfc3339());
        let _ = writeln!(out, "- duration: {}s", duration.num_seconds().max(0));
    }
    let _ = writeln!(out, "- status: {:?}", metadata.status);
    let _ = writeln!(out);
    let _ = writeln!(out, "## Counters");
    let c = &metadata.counters;
    let _ = writeln!(out, "- events_total: {}", c.events_total);
    let _ = writeln!(out, "- llm_calls: {}", c.llm_calls);
    let _ = writeln!(out, "- iterations: {}", c.iterations);
    let _ = writeln!(out, "- blockers: {}", c.blockers);
    let _ = writeln!(out, "- retries: {}", c.retries);
    let _ = writeln!(out, "- tool_calls: {}", c.tool_calls);
    let _ = writeln!(out, "- narration_deltas: {}", c.narration_deltas);
    let _ = writeln!(out, "- task_completed: {}", c.task_completed);
    let _ = writeln!(out, "- task_failed: {}", c.task_failed);
    let _ = writeln!(out, "- input_tokens: {}", c.input_tokens);
    let _ = writeln!(out, "- output_tokens: {}", c.output_tokens);
    let _ = writeln!(out);
    if !metadata.tasks.is_empty() {
        let _ = writeln!(out, "## Tasks");
        for task in &metadata.tasks {
            let status = task.status.as_deref().unwrap_or("in_progress");
            let _ = writeln!(out, "- `{}` — {}", task.task_id, status);
        }
    }
    out
}
