pub(crate) mod parser;
mod streaming;

use std::sync::Arc;

use serde::Serialize;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::RocksStore;
use aura_storage::StorageClient;

use aura_billing::MeteredLlm;
use crate::error::SpecGenError;

use parser::{RawSpecOutput, parse_claude_response, raw_to_specs};

pub type ProgressTx = mpsc::UnboundedSender<String>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum SpecStreamEvent {
    Progress(String),
    SpecsTitle(String),
    SpecsSummary(String),
    Delta(String),
    Generating { tokens: usize },
    SpecSaved(Spec),
    TaskSaved(Box<Task>),
    TokenUsage { input_tokens: u64, output_tokens: u64 },
    Complete(Vec<Spec>),
    Error(String),
}

pub(crate) const MAX_TOKENS: u32 = 32768;

pub(crate) const SPEC_OVERVIEW_MAX_TOKENS: u32 = 256;

fn storage_spec_to_core(s: aura_storage::StorageSpec) -> Result<Spec, String> {
    use chrono::{DateTime, Utc};
    let parse_dt = |v: &Option<String>| -> DateTime<Utc> {
        v.as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now)
    };
    Ok(Spec {
        spec_id: s.id.parse().map_err(|e| format!("invalid spec id: {e}"))?,
        project_id: s
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid project id: {e}"))?,
        title: s.title.unwrap_or_default(),
        order_index: s.order_index.unwrap_or(0) as u32,
        markdown_contents: s.markdown_contents.unwrap_or_default(),
        created_at: parse_dt(&s.created_at),
        updated_at: parse_dt(&s.updated_at),
    })
}

pub(crate) const SPEC_SUMMARY_MAX_TOKENS: u32 = 512;
pub(crate) const SPEC_SUMMARY_MAX_WORDS: usize = 85;

pub struct SpecGenerationService {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) llm: Arc<MeteredLlm>,
    pub(crate) storage_client: Option<Arc<StorageClient>>,
}

impl SpecGenerationService {
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
        storage_client: Option<Arc<StorageClient>>,
    ) -> Self {
        Self {
            store,
            settings,
            llm,
            storage_client,
        }
    }

    fn get_jwt(&self) -> Result<String, SpecGenError> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| SpecGenError::ParseError("no active session".into()))?;
        let session: ZeroAuthSession =
            serde_json::from_slice(&bytes).map_err(|e| SpecGenError::ParseError(e.to_string()))?;
        Ok(session.access_token)
    }

    fn require_storage(&self) -> Result<&Arc<StorageClient>, SpecGenError> {
        self.storage_client
            .as_ref()
            .ok_or_else(|| SpecGenError::ParseError("aura-storage is not configured".into()))
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
                "No requirements document configured".to_string()
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

        let llm_response = self
            .llm
            .complete(
                &api_key,
                SPEC_GENERATION_SYSTEM_PROMPT,
                &requirements_content,
                MAX_TOKENS,
                "aura_spec_gen",
                None,
            )
            .await
            .map_err(|e| {
                error!(%project_id, error = %e, "LLM call failed");
                SpecGenError::from(e)
            })?;
        let response = llm_response.text;

        info!(%project_id, response_len = response.len(), "LLM response received");

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

        self.save_specs(project_id, &new_specs).await?;
        info!(%project_id, count = new_specs.len(), "Specs saved to database");

        Ok(new_specs)
    }

    pub(crate) async fn clear_project_specs(&self, project_id: &ProjectId) -> Result<(), SpecGenError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let pid = project_id.to_string();

        let existing_specs = storage.list_specs(&pid, &jwt).await?;
        for spec in &existing_specs {
            if let Err(e) = storage.delete_spec(&spec.id, &jwt).await {
                error!(spec_id = %spec.id, error = %e, "Failed to delete spec from aura-storage");
            }
        }

        if let Ok(mut project) = self.store.get_project(project_id) {
            project.specs_summary = None;
            project.specs_title = None;
            let _ = self.store.put_project(&project);
        }
        Ok(())
    }

    pub(crate) async fn save_tasks_for_spec(&self, tasks: &[Task]) -> Result<(), SpecGenError> {
        if tasks.is_empty() {
            return Ok(());
        }
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        for task in tasks {
            let req = aura_storage::CreateTaskRequest {
                spec_id: task.spec_id.to_string(),
                title: task.title.clone(),
                description: Some(task.description.clone()),
                status: Some("ready".to_string()),
                order_index: Some(task.order_index as i32),
                dependency_ids: if task.dependency_ids.is_empty() {
                    None
                } else {
                    Some(task.dependency_ids.iter().map(|id| id.to_string()).collect())
                },
            };
            storage.create_task(&task.project_id.to_string(), &jwt, &req).await?;
        }
        Ok(())
    }

    pub(crate) async fn save_single_spec(&self, spec: &Spec) -> Result<(), SpecGenError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let req = aura_storage::CreateSpecRequest {
            title: spec.title.clone(),
            order_index: Some(spec.order_index as i32),
            markdown_contents: Some(spec.markdown_contents.clone()),
        };
        storage
            .create_spec(&spec.project_id.to_string(), &jwt, &req)
            .await?;
        Ok(())
    }

    pub(crate) async fn save_specs(&self, project_id: &ProjectId, new_specs: &[Spec]) -> Result<(), SpecGenError> {
        self.clear_project_specs(project_id).await?;

        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let pid = project_id.to_string();

        for spec in new_specs {
            let req = aura_storage::CreateSpecRequest {
                title: spec.title.clone(),
                order_index: Some(spec.order_index as i32),
                markdown_contents: Some(spec.markdown_contents.clone()),
            };
            storage.create_spec(&pid, &jwt, &req).await?;
        }
        Ok(())
    }

    pub async fn list_specs(&self, project_id: &ProjectId) -> Result<Vec<Spec>, SpecGenError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_specs = storage
            .list_specs(&project_id.to_string(), &jwt)
            .await?;
        let mut specs: Vec<Spec> = storage_specs
            .into_iter()
            .filter_map(|s| storage_spec_to_core(s).ok())
            .collect();
        specs.sort_by_key(|s| s.order_index);
        Ok(specs)
    }

    pub async fn get_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> Result<Spec, SpecGenError> {
        let _ = project_id;
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_spec = storage.get_spec(&spec_id.to_string(), &jwt).await?;
        storage_spec_to_core(storage_spec).map_err(|e| SpecGenError::ParseError(e))
    }

    /// Test-only wrapper for parse_claude_response.
    pub fn parse_claude_response_for_test(
        response: &str,
    ) -> Result<Vec<RawSpecOutput>, SpecGenError> {
        parse_claude_response(response)
    }
}
