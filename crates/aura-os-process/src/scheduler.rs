use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use cron::Schedule;
use tracing::{info, warn};

use aura_os_core::ProcessRunTrigger;

use crate::executor::ProcessExecutor;
use crate::process_store::ProcessStore;

pub struct ProcessScheduler {
    store: Arc<ProcessStore>,
    executor: Arc<ProcessExecutor>,
}

impl ProcessScheduler {
    pub fn new(store: Arc<ProcessStore>, executor: Arc<ProcessExecutor>) -> Self {
        Self { store, executor }
    }

    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                if let Err(e) = self.tick() {
                    warn!(error = %e, "Process scheduler tick failed");
                }
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
    }

    fn tick(&self) -> Result<(), String> {
        let processes = self.store.list_processes().map_err(|e| e.to_string())?;
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
                {
                    Ok(run) => {
                        process.last_run_at = Some(run.started_at);
                        process.next_run_at = schedule.upcoming(Utc).next();
                        process.updated_at = now;
                        let _ = self.store.save_process(&process);
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
