use std::sync::Arc;

use chrono::Utc;
use tokio::time::{interval, Duration};
use tracing::{info, warn};

use aura_os_core::CronJobTrigger;

use crate::cron_store::CronStore;
use crate::executor::CronJobExecutor;

pub struct CronScheduler {
    store: Arc<CronStore>,
    executor: Arc<CronJobExecutor>,
}

impl CronScheduler {
    pub fn new(store: Arc<CronStore>, executor: Arc<CronJobExecutor>) -> Self {
        Self { store, executor }
    }

    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(30));
            loop {
                ticker.tick().await;
                self.tick().await;
            }
        });
    }

    async fn tick(&self) {
        let jobs = match self.store.list_jobs() {
            Ok(j) => j,
            Err(e) => {
                warn!(error = %e, "Failed to list cron jobs");
                return;
            }
        };

        let now = Utc::now();
        for job in jobs {
            if !job.enabled {
                continue;
            }
            if let Some(next_run) = job.next_run_at {
                if next_run <= now {
                    let executor = self.executor.clone();
                    let store = self.store.clone();
                    let job_clone = job.clone();
                    tokio::spawn(async move {
                        info!(
                            job_id = %job_clone.cron_job_id,
                            name = %job_clone.name,
                            "Executing scheduled cron job"
                        );
                        if let Err(e) = executor
                            .execute(&job_clone, CronJobTrigger::Scheduled)
                            .await
                        {
                            warn!(
                                job_id = %job_clone.cron_job_id,
                                error = %e,
                                "Cron job execution failed"
                            );
                        }
                        if let Ok(Some(mut updated_job)) =
                            store.get_job(&job_clone.cron_job_id)
                        {
                            if let Some(next) = compute_next_run(&updated_job.schedule) {
                                updated_job.next_run_at = Some(next);
                                let _ = store.save_job(&updated_job);
                            }
                        }
                    });
                }
            }
        }
    }
}

pub fn compute_next_run(schedule: &str) -> Option<chrono::DateTime<Utc>> {
    use std::str::FromStr;
    let normalized = normalize_cron_expr(schedule);
    let sched = cron::Schedule::from_str(&normalized).ok()?;
    sched.upcoming(Utc).next()
}

/// The `cron` crate expects 6-field (sec min hour dom mon dow) or 7-field
/// expressions, but users typically write standard 5-field Unix cron
/// (min hour dom mon dow). Prepend "0" for seconds when we detect 5 fields.
pub fn normalize_cron_expr(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() == 5 {
        format!("0 {expr}")
    } else {
        expr.to_string()
    }
}
