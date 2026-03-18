use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;
use aura_billing::MeteredLlm;
use aura_settings::SettingsService;
use aura_store::{BatchOp, ColumnFamilyName, RocksStore};

use crate::error::TaskError;
use crate::TaskService;

const EXTRACTION_MAX_TOKENS: u32 = 8192;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RawTaskOutput {
    pub title: String,
    pub description: String,
    pub depends_on: Vec<String>,
}

pub struct TaskExtractionService {
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    llm: Arc<MeteredLlm>,
}

impl TaskExtractionService {
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
    ) -> Self {
        Self {
            store,
            settings,
            llm,
        }
    }

    async fn extract_tasks_from_spec(
        &self,
        spec: &Spec,
        api_key: &str,
    ) -> Result<Vec<(RawTaskOutput, u32)>, TaskError> {
        let resp = self
            .llm
            .complete_with_model(
                aura_claude::MID_MODEL,
                api_key,
                TASK_EXTRACTION_SYSTEM_PROMPT,
                &spec.markdown_contents,
                EXTRACTION_MAX_TOKENS,
                "aura_task_extraction",
                None,
            )
            .await?;

        let raw_tasks = Self::parse_extraction_response(&resp.text)?;

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

        let mut all_raw: Vec<(RawTaskOutput, ProjectId, SpecId, u32)> = Vec::new();

        for spec in &specs {
            let raw_tasks = self.extract_tasks_from_spec(spec, &api_key).await?;
            for (raw, order) in raw_tasks {
                all_raw.push((raw, *project_id, spec.spec_id, order));
            }
        }

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
                parent_task_id: None,
                assigned_agent_instance_id: None,
                completed_by_agent_instance_id: None,
                session_id: None,
                execution_notes: String::new(),
                files_changed: vec![],
                live_output: String::new(),
                build_steps: vec![],
                test_steps: vec![],
                user_id: None,
                model: None,
                total_input_tokens: 0,
                total_output_tokens: 0,
                created_at: now,
                updated_at: now,
            });
        }

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
        // that predecessor.
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

        for task in &mut tasks {
            if task.dependency_ids.is_empty() {
                task.status = TaskStatus::Ready;
            }
        }

        TaskService::detect_cycles(&tasks)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // parse_extraction_response
    // -----------------------------------------------------------------------

    #[test]
    fn parse_valid_task_json() {
        let input = r#"[
            {"title": "Setup DB", "description": "Create tables", "depends_on": []},
            {"title": "Add API", "description": "REST endpoints", "depends_on": ["Setup DB"]}
        ]"#;
        let tasks = TaskExtractionService::parse_extraction_response(input).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "Setup DB");
        assert!(tasks[0].depends_on.is_empty());
        assert_eq!(tasks[1].title, "Add API");
        assert_eq!(tasks[1].depends_on, vec!["Setup DB"]);
    }

    #[test]
    fn parse_fenced_task_json() {
        let input = r#"
Here are the extracted tasks:

```json
[{"title": "Init project", "description": "Scaffold", "depends_on": []}]
```
"#;
        let tasks = TaskExtractionService::parse_extraction_response(input).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Init project");
    }

    #[test]
    fn parse_empty_task_array_errors() {
        let input = "[]";
        let err = TaskExtractionService::parse_extraction_response(input).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("empty"), "expected empty error, got: {msg}");
    }

    #[test]
    fn parse_invalid_task_json_errors() {
        let input = "not json at all";
        assert!(TaskExtractionService::parse_extraction_response(input).is_err());
    }

    #[test]
    fn parse_fenced_without_lang_tag() {
        let input = "```\n[{\"title\":\"T\",\"description\":\"D\",\"depends_on\":[]}]\n```";
        let tasks = TaskExtractionService::parse_extraction_response(input).unwrap();
        assert_eq!(tasks.len(), 1);
    }

    // -----------------------------------------------------------------------
    // extract_fenced_json
    // -----------------------------------------------------------------------

    #[test]
    fn extract_fenced_json_with_lang() {
        let input = "text\n```json\n{\"key\":\"val\"}\n```\nmore";
        let result = TaskExtractionService::extract_fenced_json(input).unwrap();
        assert_eq!(result, "{\"key\":\"val\"}");
    }

    #[test]
    fn extract_fenced_json_without_lang() {
        let input = "```\n[1,2,3]\n```";
        let result = TaskExtractionService::extract_fenced_json(input).unwrap();
        assert_eq!(result, "[1,2,3]");
    }

    #[test]
    fn extract_fenced_json_no_fence_returns_none() {
        let input = "no fences here";
        assert!(TaskExtractionService::extract_fenced_json(input).is_none());
    }

    #[test]
    fn extract_fenced_json_unclosed_returns_none() {
        let input = "```json\n{\"key\":\"val\"}";
        assert!(TaskExtractionService::extract_fenced_json(input).is_none());
    }
}
