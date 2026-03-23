use std::time::Instant;

use tokio::sync::watch;
use tracing::info;

use aura_core::*;

use super::loop_context::LoopRunContext;
use super::orchestrator::DevLoopEngine;
use super::types::*;
use crate::error::EngineError;
use crate::events::EngineEvent;

impl LoopRunContext {
    pub async fn try_session_rollover(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &mut watch::Receiver<LoopCommand>,
    ) -> Result<Option<LoopOutcome>, EngineError> {
        info!(
            %self.project_id,
            session_id = %self.session.session_id,
            sessions_used = self.sessions_used,
            "Checking session rollover"
        );

        let current_session = engine
            .session_service
            .get_session(
                &self.project_id,
                &self.agent_instance_id,
                &self.session.session_id,
            )
            .await?;
        if !engine.session_service.should_rollover(&current_session) {
            return Ok(None);
        }
        let project = engine
            .project_service
            .get_project_async(&self.project_id)
            .await?;
        let history = build_rollover_history(&project, &self.work_log, self.completed_count);

        let summary_start = Instant::now();
        let summary = tokio::select! {
            res = engine.session_service.generate_rollover_summary(
                engine.llm.as_ref(), &self.api_key, &history,
            ) => { res? }
            _ = stop_rx.changed() => {
                self.finish_working(engine).await;
                return Ok(Some(self.stop_or_pause(engine, stop_rx).await));
            }
        };
        let summary_duration_ms = summary_start.elapsed().as_millis() as u64;
        let context_usage_pct = current_session.context_usage_estimate * 100.0;
        info!(
            %self.project_id,
            old_session_id = %self.session.session_id,
            context_usage_pct = context_usage_pct as u32,
            summary_duration_ms,
            tasks_completed = self.completed_count,
            "Performing session rollover"
        );
        let new_session = engine
            .session_service
            .rollover_session(
                &self.project_id,
                &self.agent_instance_id,
                &self.session.session_id,
                summary,
                None,
            )
            .await?;
        engine.emit(EngineEvent::SessionRolledOver {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            old_session_id: self.session.session_id,
            new_session_id: new_session.session_id,
            summary_duration_ms: Some(summary_duration_ms),
            context_usage_pct: Some(context_usage_pct),
        });
        self.sessions_used += 1;
        self.session = new_session;
        self.work_log.clear();
        Ok(None)
    }
}

fn build_rollover_history(
    project: &Project,
    work_log: &[String],
    completed_count: usize,
) -> String {
    let mut raw_log = work_log.join("\n\n---\n\n");
    const MAX_WORK_LOG_CHARS: usize = 20_000;
    if raw_log.len() > MAX_WORK_LOG_CHARS {
        raw_log.truncate(MAX_WORK_LOG_CHARS);
        raw_log.push_str("\n\n... (work log truncated) ...");
    }
    format!(
        "Project: {}\nDescription: {}\n\nSession work log ({} tasks completed):\n\n{}",
        project.name, project.description, completed_count, raw_log,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_core::testutil::make_project;

    #[test]
    fn test_build_rollover_history_with_tasks() {
        let project = make_project("test", "/tmp/test");
        let log = vec![
            "Implemented auth module".to_string(),
            "Fixed tests".to_string(),
        ];
        let history = build_rollover_history(&project, &log, 2);
        assert!(history.contains("test"));
        assert!(history.contains("Implemented auth module"));
        assert!(history.contains("Fixed tests"));
        assert!(history.contains("2 tasks completed"));
    }

    #[test]
    fn test_build_rollover_history_empty() {
        let project = make_project("proj", "/tmp/proj");
        let history = build_rollover_history(&project, &[], 0);
        assert!(history.contains("proj"));
        assert!(history.contains("0 tasks completed"));
    }

    #[test]
    fn test_build_rollover_history_truncation() {
        let project = make_project("proj", "/tmp/proj");
        let log: Vec<String> = (0..1000)
            .map(|i| format!("Task {} completed with lots of detail and information", i))
            .collect();
        let history = build_rollover_history(&project, &log, 1000);
        assert!(history.contains("(work log truncated)"));
    }
}
