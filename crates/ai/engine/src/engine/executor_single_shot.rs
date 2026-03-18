use tokio::sync::mpsc;
use tracing::warn;

use aura_core::*;
use aura_claude::{ClaudeStreamEvent, StreamTokenCapture};

use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::*;
use super::types::*;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops;

impl DevLoopEngine {
    #[allow(dead_code)]
    pub(crate) async fn execute_task_single_shot(
        &self,
        project_id: &ProjectId,
        task: &Task,
        session: &Session,
        api_key: &str,
    ) -> Result<TaskExecution, EngineError> {
        let project = self.project_service.get_project(project_id)?;
        let spec = self.store.get_spec(project_id, &task.spec_id)?;
        let codebase_snapshot = file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;
        let user_message = build_execution_prompt(&project, &spec, task, session, &codebase_snapshot);

        let task_id = task.task_id;
        let pid = *project_id;
        let aiid = session.agent_instance_id;

        let mut total_inp = 0u64;
        let mut total_out = 0u64;

        let response = {
            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let forwarder = tokio::spawn(async move {
                let (mut inp, mut out) = (0u64, 0u64);
                while let Some(evt) = stream_rx.recv().await {
                    match evt {
                        ClaudeStreamEvent::Delta(text) => {
                            let _ = event_tx.send(EngineEvent::TaskOutputDelta {
                                project_id: pid, agent_instance_id: aiid,
                                task_id, delta: text,
                            });
                        }
                        ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                            inp += input_tokens;
                            out += output_tokens;
                        }
                        _ => {}
                    }
                }
                (inp, out)
            });

            let resp = self.llm.complete_stream(
                api_key, &task_execution_system_prompt(), &user_message,
                self.llm_config.task_execution_max_tokens,
                stream_tx, "aura_task", None,
            ).await?;
            let (inp, out) = forwarder.await.unwrap_or((0, 0));
            total_inp += inp;
            total_out += out;
            resp
        };

        match parse_execution_response(&response) {
            Ok(mut execution) => {
                execution.input_tokens = total_inp;
                execution.output_tokens = total_out;
                execution.parse_retries = 0;

                if let Some(corrected) = self.try_validation_correction(
                    api_key, &user_message, &response, &execution, pid, aiid,
                    task_id, &mut total_inp, &mut total_out,
                ).await? {
                    return Ok(corrected);
                }
                Ok(execution)
            }
            Err(first_err) => {
                self.retry_parse_failures(
                    api_key, &user_message, response, pid, aiid,
                    task_id, &mut total_inp, &mut total_out, first_err,
                ).await
            }
        }
    }

    async fn try_validation_correction(
        &self,
        api_key: &str,
        user_message: &str,
        response: &str,
        execution: &TaskExecution,
        pid: ProjectId,
        aiid: AgentInstanceId,
        task_id: TaskId,
        total_inp: &mut u64,
        total_out: &mut u64,
    ) -> Result<Option<TaskExecution>, EngineError> {
        let validation_report = file_ops::validate_all_file_ops(&execution.file_ops);
        if validation_report.is_empty() {
            return Ok(None);
        }

        warn!(task_id = %task_id, "pre-write validation found issues, requesting correction");
        self.emit(EngineEvent::TaskRetrying {
            project_id: pid, agent_instance_id: aiid, task_id, attempt: 1,
            reason: format!("pre-write validation: {}", &validation_report[..validation_report.len().min(200)]),
        });

        let correction_prompt = format!(
            "STOP: Your file_ops contain content that will cause build errors. \
             Fix these issues in your response:\n\n{}\n\n\
             Respond with the corrected JSON (same schema).",
            validation_report,
        );
        let messages = vec![
            ("user".to_string(), user_message.to_string()),
            ("assistant".to_string(), response.to_string()),
            ("user".to_string(), correction_prompt),
        ];

        let (sink_tx, sink_handle) = StreamTokenCapture::sink();
        let corrected = self.llm.complete_stream_multi(
            api_key, &task_execution_system_prompt(), messages,
            self.llm_config.task_execution_max_tokens,
            sink_tx, "aura_task", None,
        ).await?;
        let (inp, out, _, _) = sink_handle.finalize().await;
        *total_inp += inp;
        *total_out += out;

        if let Ok(mut corrected_exec) = parse_execution_response(&corrected) {
            corrected_exec.input_tokens = *total_inp;
            corrected_exec.output_tokens = *total_out;
            corrected_exec.parse_retries = 1;
            return Ok(Some(corrected_exec));
        }
        Ok(None)
    }

    async fn retry_parse_failures(
        &self,
        api_key: &str,
        user_message: &str,
        first_response: String,
        pid: ProjectId,
        aiid: AgentInstanceId,
        task_id: TaskId,
        total_inp: &mut u64,
        total_out: &mut u64,
        first_err: EngineError,
    ) -> Result<TaskExecution, EngineError> {
        warn!(task_id = %task_id, error = %first_err, "first execution parse failed, retrying");

        let mut last_response = first_response;
        for attempt in 1..=self.engine_config.max_execution_retries {
            self.emit(EngineEvent::TaskRetrying {
                project_id: pid, agent_instance_id: aiid, task_id, attempt,
                reason: format!("response was not valid JSON (attempt {attempt})"),
            });

            let messages = vec![
                ("user".to_string(), user_message.to_string()),
                ("assistant".to_string(), last_response.clone()),
                ("user".to_string(), RETRY_CORRECTION_PROMPT.to_string()),
            ];

            let (sink_tx, sink_handle) = StreamTokenCapture::sink();
            let retry_resp = self.llm.complete_stream_multi(
                api_key, &task_execution_system_prompt(), messages,
                self.llm_config.task_execution_max_tokens,
                sink_tx, "aura_task", None,
            ).await?;
            let (inp, out, _, _) = sink_handle.finalize().await;
            *total_inp += inp;
            *total_out += out;

            match parse_execution_response(&retry_resp) {
                Ok(mut execution) => {
                    execution.input_tokens = *total_inp;
                    execution.output_tokens = *total_out;
                    execution.parse_retries = attempt;
                    return Ok(execution);
                }
                Err(e) => {
                    warn!(task_id = %task_id, attempt, error = %e, "retry parse failed");
                    last_response = retry_resp;
                }
            }
        }

        Err(first_err)
    }
}
