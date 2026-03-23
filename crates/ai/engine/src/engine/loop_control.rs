use tokio::sync::watch;
use tracing::warn;

use aura_core::*;

use super::loop_context::LoopRunContext;
use super::orchestrator::DevLoopEngine;
use super::types::*;
use crate::events::EngineEvent;

impl LoopRunContext {
    pub(super) async fn end_session(&self, engine: &DevLoopEngine) {
        if let Err(e) = engine
            .session_service
            .end_session(
                &self.project_id,
                &self.agent_instance_id,
                &self.session.session_id,
                SessionStatus::Completed,
            )
            .await
        {
            warn!(error = %e, "failed to end session");
        }
    }

    pub(crate) async fn finish_working(&self, engine: &DevLoopEngine) {
        if let Err(e) = engine
            .agent_instance_service
            .finish_working(&self.project_id, &self.agent_instance_id)
            .await
        {
            warn!(error = %e, "failed to finish_working");
        }
    }

    async fn handle_pause(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        self.end_session(engine).await;
        engine.emit(EngineEvent::LoopPaused {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            completed_count: self.completed_count,
        });
        self.flush_metrics("paused");
        LoopOutcome::Paused {
            completed_count: self.completed_count,
        }
    }

    async fn handle_stop(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        self.end_session(engine).await;
        engine.emit(EngineEvent::LoopStopped {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            completed_count: self.completed_count,
        });
        self.flush_metrics("stopped");
        LoopOutcome::Stopped {
            completed_count: self.completed_count,
        }
    }

    pub(crate) async fn stop_or_pause(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> LoopOutcome {
        let cmd = *stop_rx.borrow();
        match cmd {
            LoopCommand::Stop => self.handle_stop(engine).await,
            _ => self.handle_pause(engine).await,
        }
    }

    pub async fn check_command(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> Option<LoopOutcome> {
        let cmd = *stop_rx.borrow();
        match cmd {
            LoopCommand::Pause => {
                self.finish_working(engine).await;
                Some(self.handle_pause(engine).await)
            }
            LoopCommand::Stop => {
                self.finish_working(engine).await;
                Some(self.handle_stop(engine).await)
            }
            LoopCommand::Continue => None,
        }
    }

    pub async fn handle_interruption(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> LoopOutcome {
        if let Err(e) = engine
            .task_service
            .reset_task_to_ready(&self.project_id, &task.spec_id, &task.task_id)
            .await
        {
            warn!(error = %e, "failed to reset task to ready after interruption");
        }
        engine.emit(EngineEvent::TaskBecameReady {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: task.task_id,
        });
        self.finish_working(engine).await;
        self.stop_or_pause(engine, stop_rx).await
    }
}
