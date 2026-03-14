pub(crate) mod parser;
mod streaming;

use std::sync::Arc;

use serde::Serialize;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::{BatchOp, ColumnFamilyName, RocksStore};

use aura_claude::ClaudeClient;
use crate::error::SpecGenError;

use parser::{RawSpecOutput, parse_claude_response, raw_to_specs};

pub type ProgressTx = mpsc::UnboundedSender<String>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SpecStreamEvent {
    Progress(String),
    Delta(String),
    Generating { tokens: usize },
    SpecSaved(Spec),
    TaskSaved(Box<Task>),
    TokenUsage { input_tokens: u64, output_tokens: u64 },
    Complete(Vec<Spec>),
    Error(String),
}

pub(crate) const MAX_TOKENS: u32 = 32768;

pub(crate) const SPEC_GENERATION_SYSTEM_PROMPT: &str = r#"
You are an expert software architect. Given a requirements document, produce
a comprehensive, detailed implementation specification broken into logical
phases ordered from most foundational to least foundational.

Each spec must be numbered sequentially starting at 1 (e.g., "Spec 01", "Spec 02", etc.).
Include the spec number in the title like: "01 — Core Domain Types".

Each spec must include a Tasks section with numbered tasks using the format
<spec_number>.<task_number>, starting at 0. For example, Spec 01 has tasks
1.0, 1.1, 1.2, etc. Spec 02 has tasks 2.0, 2.1, 2.2, etc.
Task 0 for each spec should be the setup/scaffolding task.

Respond with a JSON array. Each element has:
- "title": short title for the spec section, prefixed with the zero-padded spec number
  (e.g. "01 — Core Domain Types")
- "purpose": one detailed paragraph explaining what this section covers and why it matters
- "markdown": full, thorough markdown body including ALL of the following:
  - Major concepts (with detailed explanations, not just bullet lists)
  - Interfaces (full code-level type definitions, structs, traits, function signatures)
  - Use cases (concrete scenarios)
  - Key behaviors and invariants
  - A Tasks section as a markdown table with columns: ID, Task, Description.
    Task IDs use the format <spec_number>.<task_number> (e.g. 1.0, 1.1, 1.2).
    Each task should be specific and actionable.
  - Test criteria (concrete checklist of what must pass before moving on)
  - Dependencies on other spec sections
  - State-machine diagrams (mermaid) where applicable
  - Entity relationship diagrams (mermaid) where applicable

Be thorough and detailed. Each spec should be comprehensive enough that a
developer (or coding agent) can implement it without needing to ask clarifying
questions. Include actual code signatures, type definitions, and concrete
examples — not just high-level descriptions.

Order the array so that the most fundamental sections come first.
Respond ONLY with the JSON array, no other text.
"#;

pub struct SpecGenerationService {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) claude_client: Arc<ClaudeClient>,
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

        let req_path = project.requirements_doc_path.as_deref().unwrap_or("");
        if req_path.is_empty() || !std::path::Path::new(req_path).is_file() {
            let msg = if req_path.is_empty() {
                "No requirements document configured — use Sprints instead".to_string()
            } else {
                format!("Requirements file not found: {req_path}")
            };
            error!(%project_id, "Requirements unavailable: {}", msg);
            return Err(SpecGenError::RequirementsFileNotFound(msg));
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

        let raw_specs = parse_claude_response(&response).map_err(|e| {
            error!(%project_id, error = %e, "Failed to parse Claude response");
            debug!(%project_id, response_preview = &response[..response.len().min(1000)], "Raw Claude response");
            e
        })?;
        info!(%project_id, count = raw_specs.len(), "Parsed specs from Claude response");

        let new_specs = raw_to_specs(project_id, raw_specs);

        Self::emit(
            &progress,
            &format!("Saving {} specs to database", new_specs.len()),
        );

        self.save_specs(project_id, &new_specs)?;
        info!(%project_id, count = new_specs.len(), "Specs saved to database");

        Ok(new_specs)
    }

    pub(crate) fn clear_project_specs(&self, project_id: &ProjectId) -> Result<(), SpecGenError> {
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
        if !ops.is_empty() {
            self.store.write_batch(ops)?;
        }
        Ok(())
    }

    pub(crate) fn save_tasks_for_spec(&self, tasks: &[Task]) -> Result<(), SpecGenError> {
        if tasks.is_empty() {
            return Ok(());
        }
        let ops: Vec<BatchOp> = tasks
            .iter()
            .filter_map(|task| {
                serde_json::to_vec(task)
                    .ok()
                    .map(|value| BatchOp::Put {
                        cf: ColumnFamilyName::Tasks,
                        key: format!("{}:{}:{}", task.project_id, task.spec_id, task.task_id),
                        value,
                    })
            })
            .collect();
        self.store.write_batch(ops)?;
        Ok(())
    }

    pub(crate) fn save_single_spec(&self, spec: &Spec) -> Result<(), SpecGenError> {
        self.store.write_batch(vec![BatchOp::Put {
            cf: ColumnFamilyName::Specs,
            key: format!("{}:{}", spec.project_id, spec.spec_id),
            value: serde_json::to_vec(spec)
                .map_err(|e| SpecGenError::ParseError(e.to_string()))?,
        }])?;
        Ok(())
    }

    pub(crate) fn save_specs(&self, project_id: &ProjectId, new_specs: &[Spec]) -> Result<(), SpecGenError> {
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

    /// Test-only wrapper for parse_claude_response.
    pub fn parse_claude_response_for_test(
        response: &str,
    ) -> Result<Vec<RawSpecOutput>, SpecGenError> {
        parse_claude_response(response)
    }
}
