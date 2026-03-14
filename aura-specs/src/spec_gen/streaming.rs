use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::*;

use aura_claude::ClaudeStreamEvent;

use super::parser::{IncrementalSpecParser, RawSpecOutput, parse_claude_response, parse_tasks_from_markdown, raw_to_specs};
use super::{SpecGenerationService, SpecStreamEvent, SPEC_GENERATION_SYSTEM_PROMPT, MAX_TOKENS};

impl SpecGenerationService {
    pub async fn generate_specs_streaming(
        &self,
        project_id: &ProjectId,
        tx: mpsc::UnboundedSender<SpecStreamEvent>,
    ) {
        let send = |evt: SpecStreamEvent| {
            let _ = tx.send(evt);
        };

        let (requirements_content, api_key) =
            match self.load_project_and_key(project_id, &send) {
                Some(v) => v,
                None => return,
            };

        send(SpecStreamEvent::Progress("Calling Claude to generate specs".into()));

        if let Err(e) = self.clear_project_specs(project_id) {
            send(SpecStreamEvent::Error(format!("Failed to clear existing specs: {e}")));
            return;
        }

        let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

        let client = self.claude_client.clone();
        let api_key_owned = api_key;
        let req_owned = requirements_content;
        let stream_handle = tokio::spawn(async move {
            client
                .complete_stream(
                    &api_key_owned,
                    SPEC_GENERATION_SYSTEM_PROMPT,
                    &req_owned,
                    MAX_TOKENS,
                    claude_tx,
                )
                .await
        });

        let mut parser = IncrementalSpecParser::new();
        let mut token_count: usize = 0;
        let mut delta_count: usize = 0;
        let mut spec_index: u32 = 0;
        let mut saved_specs: Vec<Spec> = Vec::new();
        let now = Utc::now();

        while let Some(evt) = claude_rx.recv().await {
            match evt {
                ClaudeStreamEvent::Delta(text) => {
                    token_count += text.split_whitespace().count().max(1);
                    delta_count += 1;
                    let _ = tx.send(SpecStreamEvent::Delta(text.clone()));
                    if delta_count.is_multiple_of(20) {
                        let _ = tx.send(SpecStreamEvent::Generating { tokens: token_count });
                    }

                    for json_obj in parser.feed(&text) {
                        if let Ok(raw) = serde_json::from_str::<RawSpecOutput>(&json_obj) {
                            let spec = Spec {
                                spec_id: SpecId::new(),
                                project_id: *project_id,
                                title: raw.title,
                                order_index: spec_index,
                                markdown_contents: format!(
                                    "## Purpose\n\n{}\n\n{}",
                                    raw.purpose, raw.markdown
                                ),
                                sprint_id: None,
                                created_at: now,
                                updated_at: now,
                            };
                            self.save_and_emit_spec(
                                project_id, &spec, &tx, &mut spec_index, &mut saved_specs,
                            );
                        }
                    }
                }
                ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                    let _ = tx.send(SpecStreamEvent::Generating { tokens: token_count });
                    let _ = tx.send(SpecStreamEvent::TokenUsage { input_tokens, output_tokens });
                }
                ClaudeStreamEvent::Error(msg) => {
                    let _ = tx.send(SpecStreamEvent::Error(msg));
                }
                ClaudeStreamEvent::ToolUse { .. } => {}
                ClaudeStreamEvent::ThinkingDelta(_) => {}
            }
        }

        let response_text = match stream_handle.await {
            Ok(Ok(text)) => Some(text),
            Ok(Err(e)) => {
                if saved_specs.is_empty() {
                    send(SpecStreamEvent::Error(format!("Claude API error: {e}")));
                    return;
                }
                None
            }
            Err(e) => {
                if saved_specs.is_empty() {
                    send(SpecStreamEvent::Error(format!("Stream task error: {e}")));
                    return;
                }
                None
            }
        };

        if saved_specs.is_empty() {
            if let Some(text) = response_text {
                self.try_fallback_parse(project_id, &text, &tx, &mut saved_specs);
                if saved_specs.is_empty() {
                    return;
                }
            }
        }

        info!(%project_id, count = saved_specs.len(), "Streaming spec generation complete");
        send(SpecStreamEvent::Complete(saved_specs));
    }

    fn load_project_and_key(
        &self,
        project_id: &ProjectId,
        send: &dyn Fn(SpecStreamEvent),
    ) -> Option<(String, String)> {
        send(SpecStreamEvent::Progress("Loading project".into()));
        info!(%project_id, "Loading project for streaming spec generation");

        let project = match self.store.get_project(project_id) {
            Ok(p) => p,
            Err(aura_store::StoreError::NotFound(_)) => {
                send(SpecStreamEvent::Error(format!("Project not found: {project_id}")));
                return None;
            }
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Store error: {e}")));
                return None;
            }
        };

        send(SpecStreamEvent::Progress("Reading requirements document".into()));

        let req_path = project.requirements_doc_path.as_deref().unwrap_or("");
        if req_path.is_empty() || !std::path::Path::new(req_path).is_file() {
            let msg = if req_path.is_empty() {
                "No requirements document configured — use Sprints instead".to_string()
            } else {
                format!("Requirements file not found: {req_path}")
            };
            send(SpecStreamEvent::Error(msg));
            return None;
        }
        let requirements_content = match std::fs::read_to_string(req_path) {
            Ok(c) => c,
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Failed to read requirements: {e}")));
                return None;
            }
        };

        send(SpecStreamEvent::Progress("Decrypting API key".into()));

        let api_key = match self.settings.get_decrypted_api_key() {
            Ok(k) => k,
            Err(e) => {
                send(SpecStreamEvent::Error(format!("API key error: {e}")));
                return None;
            }
        };

        Some((requirements_content, api_key))
    }

    fn save_and_emit_spec(
        &self,
        project_id: &ProjectId,
        spec: &Spec,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
        spec_index: &mut u32,
        saved_specs: &mut Vec<Spec>,
    ) {
        if let Err(e) = self.save_single_spec(spec) {
            error!(%project_id, error = %e, "Failed to save spec incrementally");
            return;
        }
        *spec_index += 1;
        saved_specs.push(spec.clone());
        let _ = tx.send(SpecStreamEvent::SpecSaved(spec.clone()));

        let tasks = parse_tasks_from_markdown(
            project_id,
            &spec.spec_id,
            &spec.markdown_contents,
        );
        if !tasks.is_empty() {
            if let Err(e) = self.save_tasks_for_spec(&tasks) {
                error!(%project_id, error = %e, "Failed to save tasks for spec");
            } else {
                info!(%project_id, spec = %spec.title, count = tasks.len(), "Tasks extracted and saved");
                for task in tasks {
                    let _ = tx.send(SpecStreamEvent::TaskSaved(Box::new(task)));
                }
            }
        }
    }

    fn try_fallback_parse(
        &self,
        project_id: &ProjectId,
        text: &str,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
        saved_specs: &mut Vec<Spec>,
    ) {
        let send = |evt: SpecStreamEvent| {
            let _ = tx.send(evt);
        };

        send(SpecStreamEvent::Progress("Parsing AI response".into()));
        match parse_claude_response(text) {
            Ok(raw_specs) => {
                let new_specs = raw_to_specs(project_id, raw_specs);
                send(SpecStreamEvent::Progress(format!(
                    "Saving {} specs to database",
                    new_specs.len()
                )));
                if let Err(e) = self.save_specs(project_id, &new_specs) {
                    send(SpecStreamEvent::Error(format!("Failed to save specs: {e}")));
                    return;
                }
                for spec in &new_specs {
                    send(SpecStreamEvent::SpecSaved(spec.clone()));

                    let tasks = parse_tasks_from_markdown(
                        project_id,
                        &spec.spec_id,
                        &spec.markdown_contents,
                    );
                    if !tasks.is_empty() {
                        if let Err(e) = self.save_tasks_for_spec(&tasks) {
                            error!(%project_id, error = %e, "Failed to save tasks for spec (fallback)");
                        } else {
                            for task in tasks {
                                send(SpecStreamEvent::TaskSaved(Box::new(task)));
                            }
                        }
                    }
                }
                *saved_specs = new_specs;
            }
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Parse error: {e}")));
            }
        }
    }
}
