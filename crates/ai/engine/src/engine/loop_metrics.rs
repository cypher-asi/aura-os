use std::path::Path;

use super::loop_context::LoopRunContext;
use super::orchestrator::DevLoopEngine;
use crate::events::EngineEvent;
use crate::metrics::{self, TaskMetrics};

impl LoopRunContext {
    pub(crate) fn flush_metrics(&mut self, outcome: &str) {
        self.run_metrics.finalize(
            outcome,
            self.loop_start.elapsed().as_millis() as u64,
            self.sessions_used,
            self.tasks_retried,
            self.duplicate_error_bailouts,
            &self.fee_schedule,
        );
        if !self.project_root.is_empty() {
            metrics::write_run_metrics(Path::new(&self.project_root), &self.run_metrics);
        }
    }

    pub(crate) fn record_task(&mut self, tm: TaskMetrics) {
        self.run_metrics.tasks.push(tm.clone());
        if !self.project_root.is_empty() {
            self.run_metrics.snapshot(
                self.loop_start.elapsed().as_millis() as u64,
                self.sessions_used,
                self.tasks_retried,
                self.duplicate_error_bailouts,
                &self.fee_schedule,
            );
            metrics::write_live_snapshot(Path::new(&self.project_root), &self.run_metrics, &tm);
        }
    }

    pub(crate) fn build_finished_event(&self, engine: &DevLoopEngine, outcome: &str) -> EngineEvent {
        let total_cost_usd = Some(engine.pricing_service.compute_cost(
            self.default_model.as_str(),
            self.total_input_tokens,
            self.total_output_tokens,
        ));
        EngineEvent::LoopFinished {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            outcome: outcome.into(),
            total_duration_ms: Some(self.loop_start.elapsed().as_millis() as u64),
            tasks_completed: Some(self.completed_count),
            tasks_failed: Some(self.failed_count),
            tasks_retried: Some(self.tasks_retried),
            total_input_tokens: Some(self.total_input_tokens),
            total_output_tokens: Some(self.total_output_tokens),
            total_cost_usd,
            sessions_used: Some(self.sessions_used),
            total_parse_retries: Some(self.total_parse_retries),
            total_build_fix_attempts: Some(self.total_build_fix_attempts),
            duplicate_error_bailouts: Some(self.duplicate_error_bailouts),
        }
    }
}
