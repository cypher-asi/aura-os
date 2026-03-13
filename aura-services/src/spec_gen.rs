use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::{BatchOp, ColumnFamilyName, RocksStore};

use crate::claude::ClaudeClient;
use crate::error::SpecGenError;

const MAX_TOKENS: u32 = 8192;

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

    pub async fn generate_specs(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<Spec>, SpecGenError> {
        let project = self
            .store
            .get_project(project_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => {
                    SpecGenError::ProjectNotFound(*project_id)
                }
                other => SpecGenError::Store(other),
            })?;

        let req_path = &project.requirements_doc_path;
        if !std::path::Path::new(req_path).is_file() {
            return Err(SpecGenError::RequirementsFileNotFound(req_path.clone()));
        }
        let requirements_content = std::fs::read_to_string(req_path)?;

        let api_key = self.settings.get_decrypted_api_key()?;

        let response = self
            .claude_client
            .complete(
                &api_key,
                SPEC_GENERATION_SYSTEM_PROMPT,
                &requirements_content,
                MAX_TOKENS,
            )
            .await?;

        let raw_specs = Self::parse_claude_response(&response)?;
        let new_specs = Self::raw_to_specs(project_id, raw_specs);

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

        for spec in &new_specs {
            ops.push(BatchOp::Put {
                cf: ColumnFamilyName::Specs,
                key: format!("{}:{}", spec.project_id, spec.spec_id),
                value: serde_json::to_vec(spec)
                    .map_err(|e| SpecGenError::ParseError(e.to_string()))?,
            });
        }

        self.store.write_batch(ops)?;

        Ok(new_specs)
    }

    pub fn list_specs(&self, project_id: &ProjectId) -> Result<Vec<Spec>, SpecGenError> {
        let mut specs = self.store.list_specs_by_project(project_id)?;
        specs.sort_by_key(|s| s.order_index);
        Ok(specs)
    }

    pub fn get_spec(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
    ) -> Result<Spec, SpecGenError> {
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
