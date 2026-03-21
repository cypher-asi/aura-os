use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::*;

use aura_claude::ClaudeStreamEvent;

use crate::channel_ext::send_or_log;
use crate::SpecGenError;
use super::parser::{IncrementalSpecParser, RawSpecOutput, order_index_from_spec_title, parse_claude_response, parse_tasks_from_markdown, raw_to_specs};
use super::{SpecGenerationService, SpecStreamEvent, SPEC_OVERVIEW_MAX_TOKENS, SPEC_SUMMARY_MAX_TOKENS, SPEC_SUMMARY_MAX_WORDS, MAX_TOKENS};

/// Parses "TITLE: ...\n\nsummary" format. Returns (title, summary).
/// Falls back to (None, full_text) if format not matched.
fn parse_title_and_summary(text: &str, max_summary_words: usize) -> (Option<String>, String) {
    let trimmed = text.trim();
    let title_prefix = "TITLE:";
    if let Some(i) = trimmed.to_uppercase().find(title_prefix) {
        let after_prefix = trimmed[i + title_prefix.len()..].trim_start();
        if let Some(double_newline) = after_prefix.find("\n\n") {
            let title = after_prefix[..double_newline].trim().to_string();
            let summary_raw = after_prefix[double_newline + 2..].trim();
            let summary = truncate_to_max_words(summary_raw, max_summary_words);
            let title_opt = if title.is_empty() { None } else { Some(title) };
            return (title_opt, summary);
        }
        let first_line = after_prefix.lines().next().unwrap_or("").trim();
        let rest: String = after_prefix.lines().skip(1).collect::<Vec<_>>().join("\n");
        let title_opt = if first_line.is_empty() { None } else { Some(first_line.to_string()) };
        let summary = truncate_to_max_words(rest.trim(), max_summary_words);
        return (title_opt, summary);
    }
    let summary = truncate_to_max_words(trimmed, max_summary_words);
    (None, summary)
}

fn truncate_to_max_words(s: &str, max_words: usize) -> String {
    let words: Vec<&str> = s.split_whitespace().collect();
    if words.len() <= max_words {
        s.trim().to_string()
    } else {
        words.into_iter().take(max_words).collect::<Vec<_>>().join(" ").trim().to_string()
    }
}

fn extract_purpose_excerpt(markdown: &str, max_chars: usize) -> String {
    let marker = "## Purpose";
    let content = match markdown.find(marker) {
        Some(i) => {
            let rest = &markdown[i + marker.len()..];
            let rest = rest.trim_start_matches(['\n', ' ', '\r']);
            rest
        }
        None => return String::new(),
    };
    let end = content
        .find("\n\n## ")
        .or_else(|| content.find("\n##"))
        .unwrap_or(content.len());
    let paragraph = content[..end].trim();
    if paragraph.is_empty() {
        return String::new();
    }
    if paragraph.len() <= max_chars {
        paragraph.to_string()
    } else {
        let truncate_at = paragraph
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(paragraph.len());
        format!("{}...", &paragraph[..truncate_at])
    }
}

impl SpecGenerationService {
    pub async fn generate_project_overview(
        &self,
        project_id: &ProjectId,
        requirements_content: &str,
    ) -> Result<(String, String), SpecGenError> {
        let api_key = self.settings.get_decrypted_api_key()?;
        let resp = self
            .llm
            .complete_with_model(
                aura_claude::FAST_MODEL,
                &api_key,
                SPEC_OVERVIEW_SYSTEM_PROMPT,
                requirements_content,
                SPEC_OVERVIEW_MAX_TOKENS,
                "aura_spec_gen",
                None,
            )
            .await?;
        let raw_overview = resp.text;
        let (title_opt, summary) = parse_title_and_summary(&raw_overview, SPEC_SUMMARY_MAX_WORDS);
        let title = title_opt.ok_or_else(|| {
            SpecGenError::ParseError(format!(
                "LLM did not produce a TITLE line. Raw response: {}",
                raw_overview.chars().take(200).collect::<String>()
            ))
        })?;
        if summary.is_empty() {
            return Err(SpecGenError::ParseError(format!(
                "LLM produced empty summary. Raw response: {}",
                raw_overview.chars().take(200).collect::<String>()
            )));
        }
        // Project from network; specs_title/specs_summary not persisted locally
        let _project = self.project_service.get_project_async(project_id).await?;
        Ok((title, summary))
    }

    pub async fn generate_specs_streaming(
        &self,
        project_id: &ProjectId,
        tx: mpsc::UnboundedSender<SpecStreamEvent>,
    ) {
        let send = |evt: SpecStreamEvent| { send_or_log(&tx, evt); };

        let (requirements_content, api_key) =
            match self.load_project_and_key(project_id, &tx).await {
                Some(v) => v,
                None => return,
            };
        if let Err(e) = self.clear_project_specs(project_id).await {
            send(SpecStreamEvent::Error(format!("Failed to clear existing specs: {e}")));
            return;
        }
        send(SpecStreamEvent::Progress("Generating spec overview".into()));
        match self.generate_project_overview(project_id, &requirements_content).await {
            Ok((title, summary)) => {
                send(SpecStreamEvent::SpecsTitle(title));
                send(SpecStreamEvent::SpecsSummary(summary));
            }
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Failed to generate spec overview: {e}")));
                return;
            }
        }
        send(SpecStreamEvent::Progress("Calling Claude to generate specs".into()));
        let (claude_tx, claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let llm = self.llm.clone();
        let api_key_owned = api_key;
        let req_owned = requirements_content;
        let stream_handle = tokio::spawn(async move {
            llm.complete_stream(
                &api_key_owned, SPEC_GENERATION_SYSTEM_PROMPT, &req_owned,
                MAX_TOKENS, claude_tx, "aura_spec_gen", None,
            ).await
        });
        let mut saved_specs: Vec<Spec> = Vec::new();
        self.process_spec_stream(project_id, &tx, claude_rx, &mut saved_specs).await;
        self.finalize_spec_stream(project_id, &tx, stream_handle, &mut saved_specs).await;
    }

    async fn process_spec_stream(
        &self,
        project_id: &ProjectId,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
        mut claude_rx: mpsc::UnboundedReceiver<ClaudeStreamEvent>,
        saved_specs: &mut Vec<Spec>,
    ) {
        let mut parser = IncrementalSpecParser::new();
        let (mut token_count, mut delta_count, mut spec_index) = (0usize, 0usize, 0u32);
        let now = Utc::now();

        while let Some(evt) = claude_rx.recv().await {
            match evt {
                ClaudeStreamEvent::Delta(text) => {
                    token_count += text.split_whitespace().count().max(1);
                    delta_count += 1;
                    send_or_log(tx, SpecStreamEvent::Delta(text.clone()));
                    if delta_count.is_multiple_of(20) {
                        send_or_log(tx, SpecStreamEvent::Generating { tokens: token_count });
                    }
                    for json_obj in parser.feed(&text) {
                        if let Ok(raw) = serde_json::from_str::<RawSpecOutput>(&json_obj) {
                            let order_index =
                                order_index_from_spec_title(&raw.title).unwrap_or(spec_index);
                            let spec = Spec {
                                spec_id: SpecId::new(),
                                project_id: *project_id,
                                title: raw.title,
                                order_index,
                                markdown_contents: format!(
                                    "## Purpose\n\n{}\n\n{}", raw.purpose, raw.markdown
                                ),
                                created_at: now,
                                updated_at: now,
                            };
                            self.save_and_emit_spec(
                                project_id, &spec, tx, &mut spec_index, saved_specs,
                            ).await;
                        }
                    }
                }
                ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                    send_or_log(tx, SpecStreamEvent::Generating { tokens: token_count });
                    send_or_log(tx, SpecStreamEvent::TokenUsage { input_tokens, output_tokens });
                }
                ClaudeStreamEvent::Error(msg) => {
                    send_or_log(tx, SpecStreamEvent::Error(msg));
                }
                _ => {}
            }
        }
    }

    async fn finalize_spec_stream<E: std::fmt::Display>(
        &self,
        project_id: &ProjectId,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
        stream_handle: tokio::task::JoinHandle<Result<String, E>>,
        saved_specs: &mut Vec<Spec>,
    ) {
        let send = |evt: SpecStreamEvent| { send_or_log(tx, evt); };
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
                self.try_fallback_parse(project_id, &text, tx, saved_specs).await;
                if saved_specs.is_empty() { return; }
            }
        }
        info!(%project_id, count = saved_specs.len(), "Streaming spec generation complete");
        send(SpecStreamEvent::Complete(std::mem::take(saved_specs)));
    }

    /// Regenerate project overview (title + summary) from the current specs.
    /// Used only as a manual refresh from the API endpoint.
    pub async fn regenerate_specs_summary(&self, project_id: &ProjectId) -> Result<(String, String), SpecGenError> {
        let specs = self.list_specs(project_id).await?;
        if specs.is_empty() {
            return Err(SpecGenError::ParseError("No specs found".to_string()));
        }
        let api_key = self.settings.get_decrypted_api_key()?;
        let mut lines: Vec<String> = Vec::new();
        for (i, spec) in specs.iter().enumerate() {
            let purpose = extract_purpose_excerpt(&spec.markdown_contents, 200);
            let excerpt = if purpose.is_empty() {
                spec.title.clone()
            } else {
                format!("{}: {}", spec.title, purpose)
            };
            lines.push(format!("{}. {}", i + 1, excerpt));
        }
        let user_prompt = format!(
            "Given these implementation specs:\n\n{}\n\nRespond in this exact format:\nTITLE: [3-8 word descriptive title for this spec set]\n\n[2-4 sentence summary, maximum {} words]. Name and briefly explain what each phase covers—what gets built, what it does, and how the phases connect. Be concrete and content-specific.",
            lines.join("\n"),
            SPEC_SUMMARY_MAX_WORDS
        );
        let resp = self
            .llm
            .complete_with_model(aura_claude::FAST_MODEL, &api_key, SPEC_SUMMARY_SYSTEM_PROMPT, &user_prompt, SPEC_SUMMARY_MAX_TOKENS, "aura_spec_gen", None)
            .await?;
        let response = resp.text;
        let (title_opt, summary) = parse_title_and_summary(&response, SPEC_SUMMARY_MAX_WORDS);
        let title = title_opt.ok_or_else(|| {
            SpecGenError::ParseError("LLM did not produce a TITLE line".to_string())
        })?;
        if summary.is_empty() {
            return Err(SpecGenError::ParseError("LLM produced empty summary".to_string()));
        }
        let _project = self.project_service.get_project_async(project_id).await?;
        info!(%project_id, %title, "Specs summary regenerated");
        Ok((title, summary))
    }

    async fn load_project_and_key(
        &self,
        project_id: &ProjectId,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
    ) -> Option<(String, String)> {
        send_or_log(tx, SpecStreamEvent::Progress("Loading project".into()));
        info!(%project_id, "Loading project for streaming spec generation");

        let project = match self.project_service.get_project_async(project_id).await {
            Ok(p) => p,
            Err(_) => {
                send_or_log(tx, SpecStreamEvent::Error(format!("Project not found: {project_id}")));
                return None;
            }
        };

        send_or_log(tx, SpecStreamEvent::Progress("Reading requirements document".into()));

        let req_path = project.requirements_doc_path.as_deref().unwrap_or("");
        if req_path.is_empty() || !std::path::Path::new(req_path).is_file() {
            let msg = if req_path.is_empty() {
                "No requirements document configured".to_string()
            } else {
                format!("Requirements file not found: {req_path}")
            };
            send_or_log(tx, SpecStreamEvent::Error(msg));
            return None;
        }
        let requirements_content = match std::fs::read_to_string(req_path) {
            Ok(c) => c,
            Err(e) => {
                send_or_log(tx, SpecStreamEvent::Error(format!("Failed to read requirements: {e}")));
                return None;
            }
        };

        send_or_log(tx, SpecStreamEvent::Progress("Decrypting API key".into()));

        let api_key = match self.settings.get_decrypted_api_key() {
            Ok(k) => k,
            Err(e) => {
                send_or_log(tx, SpecStreamEvent::Error(format!("API key error: {e}")));
                return None;
            }
        };

        Some((requirements_content, api_key))
    }

    async fn save_and_emit_spec(
        &self,
        project_id: &ProjectId,
        spec: &Spec,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
        spec_index: &mut u32,
        saved_specs: &mut Vec<Spec>,
    ) {
        if let Err(e) = self.save_single_spec(spec).await {
            error!(%project_id, error = %e, "Failed to save spec incrementally");
            return;
        }
        *spec_index += 1;
        saved_specs.push(spec.clone());
        send_or_log(tx, SpecStreamEvent::SpecSaved(spec.clone()));

        let tasks = parse_tasks_from_markdown(
            project_id,
            &spec.spec_id,
            &spec.markdown_contents,
        );
        if !tasks.is_empty() {
            if let Err(e) = self.save_tasks_for_spec(&tasks).await {
                error!(%project_id, error = %e, "Failed to save tasks for spec");
            } else {
                info!(%project_id, spec = %spec.title, count = tasks.len(), "Tasks extracted and saved");
                for task in tasks {
                    send_or_log(tx, SpecStreamEvent::TaskSaved(Box::new(task)));
                }
            }
        }
    }

    async fn try_fallback_parse(
        &self,
        project_id: &ProjectId,
        text: &str,
        tx: &mpsc::UnboundedSender<SpecStreamEvent>,
        saved_specs: &mut Vec<Spec>,
    ) {
        let send = |evt: SpecStreamEvent| {
            send_or_log(tx, evt);
        };

        send(SpecStreamEvent::Progress("Parsing AI response".into()));
        match parse_claude_response(text) {
            Ok(raw_specs) => {
                let new_specs = raw_to_specs(project_id, raw_specs);
                send(SpecStreamEvent::Progress(format!(
                    "Saving {} specs to database",
                    new_specs.len()
                )));
                if let Err(e) = self.save_specs(project_id, &new_specs).await {
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
                        if let Err(e) = self.save_tasks_for_spec(&tasks).await {
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

#[cfg(test)]
#[path = "streaming_tests.rs"]
mod tests;
