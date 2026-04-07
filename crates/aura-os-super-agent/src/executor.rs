use std::sync::Arc;

use chrono::Utc;
use serde_json::json;
use tokio::sync::broadcast;
use tracing::info;

use aura_os_core::{CronJob, CronJobRun, CronJobRunId, CronJobRunStatus, CronJobTrigger};

use crate::cron_store::CronStore;

pub struct CronJobExecutor {
    store: Arc<CronStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
}

impl CronJobExecutor {
    pub fn new(
        store: Arc<CronStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
    ) -> Self {
        Self {
            store,
            event_broadcast,
        }
    }

    pub async fn execute(
        &self,
        job: &CronJob,
        trigger: CronJobTrigger,
    ) -> Result<CronJobRun, String> {
        let run_id = CronJobRunId::new();
        let mut run = CronJobRun {
            run_id,
            cron_job_id: job.cron_job_id,
            status: CronJobRunStatus::Running,
            trigger,
            prompt_snapshot: String::new(),
            response_text: String::new(),
            output_artifact_ids: vec![],
            tasks_created: vec![],
            error: None,
            input_tokens: 0,
            output_tokens: 0,
            started_at: Utc::now(),
            completed_at: None,
        };
        self.store.save_run(&run).map_err(|e| e.to_string())?;

        let _ = self.event_broadcast.send(json!({
            "type": "cron_job_started",
            "cron_job_id": job.cron_job_id.to_string(),
            "run_id": run_id.to_string(),
            "job_name": &job.name,
        }));

        // Resolve input artifacts into context
        let mut context_parts: Vec<String> = Vec::new();
        for art_ref in &job.input_artifact_refs {
            let artifact = if art_ref.use_latest {
                self.store
                    .get_latest_artifact(&art_ref.source_cron_job_id, art_ref.artifact_type)
                    .ok()
                    .flatten()
            } else if art_ref.specific_run_id.is_some() {
                self.store
                    .list_artifacts_for_job(&art_ref.source_cron_job_id)
                    .ok()
                    .and_then(|arts| arts.into_iter().next())
            } else {
                None
            };
            if let Some(art) = artifact {
                context_parts.push(format!(
                    "### {} (type: {:?})\n{}",
                    art.name, art.artifact_type, art.content
                ));
            }
        }

        let prompt = if context_parts.is_empty() {
            job.prompt.clone()
        } else {
            format!(
                "## Input Context\n\n{}\n\n## Your Task\n\n{}",
                context_parts.join("\n\n"),
                job.prompt
            )
        };
        run.prompt_snapshot = prompt.clone();

        // Headless execution stub: records intent and marks completed.
        // A full implementation would drive SuperAgentStream with a service account.
        run.status = CronJobRunStatus::Completed;
        run.completed_at = Some(Utc::now());
        run.response_text = format!(
            "[Cron job '{}' executed. Prompt: {}]",
            job.name,
            &prompt[..prompt.len().min(200)]
        );

        self.store.save_run(&run).map_err(|e| e.to_string())?;

        if let Ok(Some(mut updated_job)) = self.store.get_job(&job.cron_job_id) {
            updated_job.last_run_at = Some(Utc::now());
            updated_job.updated_at = Utc::now();
            let _ = self.store.save_job(&updated_job);
        }

        info!(
            job_id = %job.cron_job_id,
            run_id = %run_id,
            "Cron job execution completed"
        );

        let _ = self.event_broadcast.send(json!({
            "type": "cron_job_completed",
            "cron_job_id": job.cron_job_id.to_string(),
            "run_id": run_id.to_string(),
            "job_name": &job.name,
            "artifacts_count": run.output_artifact_ids.len(),
            "duration_ms": run.completed_at
                .map(|c| (c - run.started_at).num_milliseconds())
                .unwrap_or(0),
        }));

        Ok(run)
    }
}
