use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::{BatchOp, ColumnFamilyName, RocksStore};

use crate::claude::ClaudeClient;
use crate::error::TaskError;
use crate::task::TaskService;

const EXTRACTION_MAX_TOKENS: u32 = 8192;

pub(crate) const TASK_EXTRACTION_SYSTEM_PROMPT: &str = r#"
You are a software implementation planner. Given a specification document,
extract concrete implementation tasks.

Respond with a JSON array. Each element has:
- "title": short task title (imperative form, e.g., "Implement X")
- "description": detailed description of what to implement and how to verify
- "depends_on": array of task titles this task depends on (empty if none)

Order tasks from most foundational to most dependent.
Respond ONLY with the JSON array, no other text.
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RawTaskOutput {
    pub title: String,
    pub description: String,
    pub depends_on: Vec<String>,
}

pub struct TaskExtractionService {
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    claude_client: Arc<ClaudeClient>,
}

impl TaskExtractionService {
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

    async fn extract_tasks_from_spec(
        &self,
        spec: &Spec,
        api_key: &str,
    ) -> Result<Vec<(RawTaskOutput, u32)>, TaskError> {
        let response = self
            .claude_client
            .complete(
                api_key,
                TASK_EXTRACTION_SYSTEM_PROMPT,
                &spec.markdown_contents,
                EXTRACTION_MAX_TOKENS,
            )
            .await?;

        let raw_tasks = Self::parse_extraction_response(&response)?;

        Ok(raw_tasks
            .into_iter()
            .enumerate()
            .map(|(i, raw)| (raw, i as u32))
            .collect())
    }

    pub async fn extract_all_tasks(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let mut specs = self.store.list_specs_by_project(project_id)?;
        specs.sort_by_key(|s| s.order_index);

        let api_key = self.settings.get_decrypted_api_key()?;

        // Collect all raw tasks with their spec info
        let mut all_raw: Vec<(RawTaskOutput, ProjectId, SpecId, u32)> = Vec::new();

        for spec in &specs {
            let raw_tasks = self.extract_tasks_from_spec(spec, &api_key).await?;
            for (raw, order) in raw_tasks {
                all_raw.push((raw, *project_id, spec.spec_id, order));
            }
        }

        // Create Task entities with temporary string-based deps
        let now = Utc::now();
        let mut tasks: Vec<Task> = Vec::new();
        let mut title_to_id: HashMap<String, TaskId> = HashMap::new();
        let mut raw_deps: Vec<Vec<String>> = Vec::new();

        for (raw, pid, sid, order) in &all_raw {
            let task_id = TaskId::new();
            title_to_id.insert(raw.title.clone(), task_id);
            raw_deps.push(raw.depends_on.clone());

            tasks.push(Task {
                task_id,
                project_id: *pid,
                spec_id: *sid,
                title: raw.title.clone(),
                description: raw.description.clone(),
                status: TaskStatus::Pending,
                order_index: *order,
                dependency_ids: vec![],
                assigned_agent_id: None,
                session_id: None,
                execution_notes: String::new(),
                files_changed: vec![],
                live_output: String::new(),
                created_at: now,
                updated_at: now,
            });
        }

        // Resolve string dependencies to TaskIds
        for (i, dep_titles) in raw_deps.iter().enumerate() {
            let mut resolved_deps = Vec::new();
            for title in dep_titles {
                if let Some(&dep_id) = title_to_id.get(title) {
                    resolved_deps.push(dep_id);
                }
            }
            tasks[i].dependency_ids = resolved_deps;
        }

        // Auto-chain tasks within each spec: if task[i] has no dependencies
        // and the previous task in the same spec exists, make it depend on
        // that predecessor. This ensures sequential execution within a spec
        // when the LLM omits depends_on.
        {
            let mut last_in_spec: HashMap<SpecId, TaskId> = HashMap::new();
            for task in &mut tasks {
                if let Some(&prev_id) = last_in_spec.get(&task.spec_id) {
                    if task.dependency_ids.is_empty() {
                        task.dependency_ids.push(prev_id);
                    }
                }
                last_in_spec.insert(task.spec_id, task.task_id);
            }
        }

        // Set initial statuses: only tasks with no dependencies start as Ready
        for task in &mut tasks {
            if task.dependency_ids.is_empty() {
                task.status = TaskStatus::Ready;
            }
        }

        // Detect cycles
        TaskService::detect_cycles(&tasks)?;

        // Delete existing tasks for this project
        let existing_tasks = self.store.list_tasks_by_project(project_id)?;
        let mut ops: Vec<BatchOp> = Vec::new();

        for old_task in &existing_tasks {
            ops.push(BatchOp::Delete {
                cf: ColumnFamilyName::Tasks,
                key: format!(
                    "{}:{}:{}",
                    old_task.project_id, old_task.spec_id, old_task.task_id
                ),
            });
        }

        for task in &tasks {
            ops.push(BatchOp::Put {
                cf: ColumnFamilyName::Tasks,
                key: format!("{}:{}:{}", task.project_id, task.spec_id, task.task_id),
                value: serde_json::to_vec(task)
                    .map_err(|e| TaskError::ParseError(e.to_string()))?,
            });
        }

        self.store.write_batch(ops)?;

        Ok(tasks)
    }

    fn parse_extraction_response(response: &str) -> Result<Vec<RawTaskOutput>, TaskError> {
        let trimmed = response.trim();

        if let Ok(tasks) = serde_json::from_str::<Vec<RawTaskOutput>>(trimmed) {
            if tasks.is_empty() {
                return Err(TaskError::ParseError(
                    "Claude returned an empty task array".into(),
                ));
            }
            return Ok(tasks);
        }

        // Try fenced code block
        if let Some(json_str) = Self::extract_fenced_json(trimmed) {
            if let Ok(tasks) = serde_json::from_str::<Vec<RawTaskOutput>>(&json_str) {
                if tasks.is_empty() {
                    return Err(TaskError::ParseError(
                        "Claude returned an empty task array".into(),
                    ));
                }
                return Ok(tasks);
            }
        }

        Err(TaskError::ParseError(format!(
            "failed to parse task extraction response: {}",
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
}
