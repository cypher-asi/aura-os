use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, info};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::{BatchOp, ColumnFamilyName, RocksStore};

use crate::claude::{ClaudeClient, ClaudeStreamEvent};
use crate::error::SpecGenError;

pub type ProgressTx = mpsc::UnboundedSender<String>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SpecStreamEvent {
    Progress(String),
    Generating { tokens: usize },
    Complete(Vec<Spec>),
    Error(String),
}

const MAX_TOKENS: u32 = 16384;

pub(crate) const SPEC_GENERATION_SYSTEM_PROMPT: &str = r#"
You are an expert software architect. Given a requirements document, produce
a structured implementation specification broken into logical phases ordered
from most foundational to least foundational.

Respond with a JSON array. Each element has:
- "title": short title for the spec section
- "purpose": one paragraph explaining what this section covers
- "markdown": full markdown body including:
  - Major concepts
  - Interfaces (code-level)
  - Use cases
  - Test cases
  - Dependencies on other sections
  - State-machine diagrams (mermaid) where applicable

Order the array so that the most fundamental sections come first.
Respond ONLY with the JSON array, no other text.
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSpecOutput {
    pub title: String,
    pub purpose: String,
    pub markdown: String,
}

pub struct SpecGenerationService {
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    claude_client: Arc<ClaudeClient>,
}

impl SpecGenerationService {
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        claude_client: Arc<ClaudeClient>,
    ) -> Self {
        Self {
            store,
            settings,
            claude_client,
        }
    }

    fn emit(progress: &Option<ProgressTx>, msg: &str) {
        if let Some(tx) = progress {
            let _ = tx.send(msg.to_string());
        }
    }

    pub async fn generate_specs(&self, project_id: &ProjectId) -> Result<Vec<Spec>, SpecGenError> {
        self.generate_specs_with_progress(project_id, None).await
    }

    pub async fn generate_specs_with_progress(
        &self,
        project_id: &ProjectId,
        progress: Option<ProgressTx>,
    ) -> Result<Vec<Spec>, SpecGenError> {
        Self::emit(&progress, "Loading project");
        info!(%project_id, "Loading project for spec generation");

        let project = self.store.get_project(project_id).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => {
                error!(%project_id, "Project not found");
                SpecGenError::ProjectNotFound(*project_id)
            }
            other => {
                error!(%project_id, error = %other, "Store error loading project");
                SpecGenError::Store(other)
            }
        })?;

        Self::emit(&progress, "Reading requirements document");

        let req_path = &project.requirements_doc_path;
        info!(%project_id, path = %req_path, "Reading requirements file");
        if !std::path::Path::new(req_path).is_file() {
            error!(%project_id, path = %req_path, "Requirements file not found");
            return Err(SpecGenError::RequirementsFileNotFound(req_path.clone()));
        }
        let requirements_content = std::fs::read_to_string(req_path).map_err(|e| {
            error!(%project_id, path = %req_path, error = %e, "Failed to read requirements file");
            e
        })?;
        info!(%project_id, bytes = requirements_content.len(), "Requirements file loaded");

        Self::emit(&progress, "Decrypting API key");

        let api_key = self.settings.get_decrypted_api_key().map_err(|e| {
            error!(%project_id, error = %e, "Failed to get API key");
            SpecGenError::Settings(e)
        })?;
        debug!(%project_id, "API key decrypted successfully");

        Self::emit(&progress, "Calling Claude to generate specs — this may take a minute");
        info!(%project_id, max_tokens = MAX_TOKENS, "Sending request to Claude API");

        let response = self
            .claude_client
            .complete(
                &api_key,
                SPEC_GENERATION_SYSTEM_PROMPT,
                &requirements_content,
                MAX_TOKENS,
            )
            .await
            .map_err(|e| {
                error!(%project_id, error = %e, "Claude API call failed");
                e
            })?;

        info!(%project_id, response_len = response.len(), "Claude API response received");

        Self::emit(&progress, "Parsing AI response");

        let raw_specs = Self::parse_claude_response(&response).map_err(|e| {
            error!(%project_id, error = %e, "Failed to parse Claude response");
            debug!(%project_id, response_preview = &response[..response.len().min(1000)], "Raw Claude response");
            e
        })?;
        info!(%project_id, count = raw_specs.len(), "Parsed specs from Claude response");

        let new_specs = Self::raw_to_specs(project_id, raw_specs);

        Self::emit(
            &progress,
            &format!("Saving {} specs to database", new_specs.len()),
        );

        self.save_specs(project_id, &new_specs)?;
        info!(%project_id, count = new_specs.len(), "Specs saved to database");

        Ok(new_specs)
    }

    pub async fn generate_specs_streaming(
        &self,
        project_id: &ProjectId,
        tx: mpsc::UnboundedSender<SpecStreamEvent>,
    ) {
        let send = |evt: SpecStreamEvent| {
            let _ = tx.send(evt);
        };

        send(SpecStreamEvent::Progress("Loading project".into()));
        info!(%project_id, "Loading project for streaming spec generation");

        let project = match self.store.get_project(project_id) {
            Ok(p) => p,
            Err(aura_store::StoreError::NotFound(_)) => {
                send(SpecStreamEvent::Error(format!("Project not found: {project_id}")));
                return;
            }
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Store error: {e}")));
                return;
            }
        };

        send(SpecStreamEvent::Progress("Reading requirements document".into()));

        let req_path = &project.requirements_doc_path;
        if !std::path::Path::new(req_path).is_file() {
            send(SpecStreamEvent::Error(format!("Requirements file not found: {req_path}")));
            return;
        }
        let requirements_content = match std::fs::read_to_string(req_path) {
            Ok(c) => c,
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Failed to read requirements: {e}")));
                return;
            }
        };

        send(SpecStreamEvent::Progress("Decrypting API key".into()));

        let api_key = match self.settings.get_decrypted_api_key() {
            Ok(k) => k,
            Err(e) => {
                send(SpecStreamEvent::Error(format!("API key error: {e}")));
                return;
            }
        };

        send(SpecStreamEvent::Progress("Calling Claude to generate specs".into()));

        let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

        let tx_fwd = tx.clone();
        let forwarder = tokio::spawn(async move {
            let mut token_count: usize = 0;
            let mut delta_count: usize = 0;
            while let Some(evt) = claude_rx.recv().await {
                match evt {
                    ClaudeStreamEvent::Delta(text) => {
                        token_count += text.split_whitespace().count().max(1);
                        delta_count += 1;
                        if delta_count % 20 == 0 {
                            let _ = tx_fwd.send(SpecStreamEvent::Generating { tokens: token_count });
                        }
                    }
                    ClaudeStreamEvent::Done { .. } => {
                        let _ = tx_fwd.send(SpecStreamEvent::Generating { tokens: token_count });
                    }
                    ClaudeStreamEvent::Error(msg) => {
                        let _ = tx_fwd.send(SpecStreamEvent::Error(msg));
                    }
                }
            }
        });

        let response = self.claude_client.complete_stream(
            &api_key,
            SPEC_GENERATION_SYSTEM_PROMPT,
            &requirements_content,
            MAX_TOKENS,
            claude_tx,
        ).await;

        let _ = forwarder.await;

        let response_text = match response {
            Ok(text) => text,
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Claude API error: {e}")));
                return;
            }
        };

        send(SpecStreamEvent::Progress("Parsing AI response".into()));

        let raw_specs = match Self::parse_claude_response(&response_text) {
            Ok(specs) => specs,
            Err(e) => {
                send(SpecStreamEvent::Error(format!("Parse error: {e}")));
                return;
            }
        };

        let new_specs = Self::raw_to_specs(project_id, raw_specs);

        send(SpecStreamEvent::Progress(format!("Saving {} specs to database", new_specs.len())));

        if let Err(e) = self.save_specs(project_id, &new_specs) {
            send(SpecStreamEvent::Error(format!("Failed to save specs: {e}")));
            return;
        }

        info!(%project_id, count = new_specs.len(), "Streaming spec generation complete");
        send(SpecStreamEvent::Complete(new_specs));
    }

    fn save_specs(&self, project_id: &ProjectId, new_specs: &[Spec]) -> Result<(), SpecGenError> {
        let existing_specs = self.store.list_specs_by_project(project_id)?;
        let existing_tasks = self.store.list_tasks_by_project(project_id)?;

        let mut ops: Vec<BatchOp> = Vec::new();

        for spec in &existing_specs {
            ops.push(BatchOp::Delete {
                cf: ColumnFamilyName::Specs,
                key: format!("{}:{}", spec.project_id, spec.spec_id),
            });
        }
        for task in &existing_tasks {
            ops.push(BatchOp::Delete {
                cf: ColumnFamilyName::Tasks,
                key: format!("{}:{}:{}", task.project_id, task.spec_id, task.task_id),
            });
        }

        for spec in new_specs {
            ops.push(BatchOp::Put {
                cf: ColumnFamilyName::Specs,
                key: format!("{}:{}", spec.project_id, spec.spec_id),
                value: serde_json::to_vec(spec)
                    .map_err(|e| SpecGenError::ParseError(e.to_string()))?,
            });
        }

        self.store.write_batch(ops)?;
        Ok(())
    }

    pub fn list_specs(&self, project_id: &ProjectId) -> Result<Vec<Spec>, SpecGenError> {
        let mut specs = self.store.list_specs_by_project(project_id)?;
        specs.sort_by_key(|s| s.order_index);
        Ok(specs)
    }

    pub fn get_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> Result<Spec, SpecGenError> {
        Ok(self.store.get_spec(project_id, spec_id)?)
    }

    pub(crate) fn parse_claude_response(
        response: &str,
    ) -> Result<Vec<RawSpecOutput>, SpecGenError> {
        let trimmed = response.trim();

        // Try direct JSON parse
        if let Ok(specs) = serde_json::from_str::<Vec<RawSpecOutput>>(trimmed) {
            return Self::validate_raw_specs(specs);
        }

        // Try extracting from fenced code block
        if let Some(json_str) = Self::extract_fenced_json(trimmed) {
            if let Ok(specs) = serde_json::from_str::<Vec<RawSpecOutput>>(&json_str) {
                return Self::validate_raw_specs(specs);
            }
        }

        Err(SpecGenError::ParseError(format!(
            "failed to parse Claude response as JSON array of specs. Response: {}",
            &trimmed[..trimmed.len().min(500)]
        )))
    }

    fn extract_fenced_json(text: &str) -> Option<String> {
        let start_markers = ["```json", "```"];
        for marker in &start_markers {
            if let Some(start) = text.find(marker) {
                let after_marker = start + marker.len();
                if let Some(end) = text[after_marker..].find("```") {
                    return Some(text[after_marker..after_marker + end].trim().to_string());
                }
            }
        }
        None
    }

    fn validate_raw_specs(specs: Vec<RawSpecOutput>) -> Result<Vec<RawSpecOutput>, SpecGenError> {
        if specs.is_empty() {
            return Err(SpecGenError::ParseError(
                "Claude returned an empty spec array".into(),
            ));
        }
        for (i, spec) in specs.iter().enumerate() {
            if spec.title.trim().is_empty() {
                return Err(SpecGenError::ParseError(format!(
                    "spec at index {i} has an empty title"
                )));
            }
            if spec.markdown.trim().is_empty() {
                return Err(SpecGenError::ParseError(format!(
                    "spec at index {i} has empty markdown"
                )));
            }
        }
        Ok(specs)
    }

    /// Test-only wrapper for parse_claude_response.
    pub fn parse_claude_response_for_test(
        response: &str,
    ) -> Result<Vec<RawSpecOutput>, SpecGenError> {
        Self::parse_claude_response(response)
    }

    fn raw_to_specs(project_id: &ProjectId, raw: Vec<RawSpecOutput>) -> Vec<Spec> {
        let now = Utc::now();
        raw.into_iter()
            .enumerate()
            .map(|(i, r)| Spec {
                spec_id: SpecId::new(),
                project_id: *project_id,
                title: r.title,
                order_index: i as u32,
                markdown_contents: format!("## Purpose\n\n{}\n\n{}", r.purpose, r.markdown),
                created_at: now,
                updated_at: now,
            })
            .collect()
    }
}
