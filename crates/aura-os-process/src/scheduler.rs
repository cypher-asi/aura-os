use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use cron::Schedule;
use tracing::{info, warn};

use aura_os_core::ProcessRunTrigger;
use aura_os_storage::StorageClient;

use crate::executor::ProcessExecutor;
use crate::process_store::ProcessStore;

pub struct ProcessScheduler {
    store: Arc<ProcessStore>,
    executor: Arc<ProcessExecutor>,
    storage_client: Option<Arc<StorageClient>>,
}

impl ProcessScheduler {
    pub fn new(
        store: Arc<ProcessStore>,
        executor: Arc<ProcessExecutor>,
        storage_client: Option<Arc<StorageClient>>,
    ) -> Self {
        Self {
            store,
            executor,
            storage_client,
        }
    }

    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                if let Err(e) = self.tick().await {
                    warn!(error = %e, "Process scheduler tick failed");
                }
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
    }

    async fn tick(&self) -> Result<(), String> {
        // When authoritative storage is enabled, fail closed instead of
        // resurrecting a stale local shadow copy of scheduled processes.
        let processes = if let Some(client) = &self.storage_client {
            if !client.has_internal_token() {
                return Ok(());
            }
            client
                .list_scheduled_processes_internal()
                .await
                .map(|storage_procs| {
                    storage_procs
                        .into_iter()
                        .map(super::executor::conv_process)
                        .collect()
                })
                .map_err(|error| {
                    format!(
                        "failed to list scheduled processes from authoritative process storage: {error}"
                    )
                })?
        } else {
            self.store.list_processes().map_err(|e| e.to_string())?
        };
        let now = Utc::now();

        for mut process in processes {
            if !process.enabled {
                continue;
            }

            let schedule_str = match &process.schedule {
                Some(s) if !s.is_empty() => s.clone(),
                _ => continue,
            };

            let normalized = normalize_cron_expr(&schedule_str);
            let schedule: Schedule = match normalized.parse() {
                Ok(s) => s,
                Err(e) => {
                    warn!(
                        process_id = %process.process_id,
                        schedule = %schedule_str,
                        error = %e,
                        "Invalid cron expression"
                    );
                    continue;
                }
            };

            let should_run = match process.next_run_at {
                Some(next) => now >= next,
                None => true,
            };

            if should_run {
                info!(process_id = %process.process_id, "Scheduler triggering process");
                match self
                    .executor
                    .trigger(&process.process_id, ProcessRunTrigger::Scheduled)
                    .await
                {
                    Ok(run) => {
                        process.last_run_at = Some(run.started_at);
                        process.next_run_at = schedule.upcoming(Utc).next();
                        process.updated_at = now;
                        let _ = self.store.save_process(&process);
                        // Sync next_run_at to storage
                        if let Some(client) = &self.storage_client {
                            let update = aura_os_storage::UpdateProcessRequest {
                                last_run_at: process.last_run_at.map(|dt| Some(dt.to_rfc3339())),
                                next_run_at: process.next_run_at.map(|dt| Some(dt.to_rfc3339())),
                                ..Default::default()
                            };
                            let _ = client
                                .update_process_internal(&process.process_id.to_string(), &update)
                                .await;
                        }
                    }
                    Err(e) => {
                        warn!(process_id = %process.process_id, error = %e, "Scheduled trigger failed");
                    }
                }
            }
        }

        Ok(())
    }
}

fn normalize_cron_expr(expr: &str) -> String {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {expr}")
    } else {
        expr.to_string()
    }
}
