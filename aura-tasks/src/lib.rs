mod error;
pub use error::TaskError;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::{BatchOp, ColumnFamilyName, RocksStore};
use aura_claude::ClaudeClient;

// ---------------------------------------------------------------------------
// ProjectProgress
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectProgress {
    pub project_id: ProjectId,
    pub total_tasks: usize,
    pub pending_tasks: usize,
    pub ready_tasks: usize,
    pub in_progress_tasks: usize,
    pub blocked_tasks: usize,
    pub done_tasks: usize,
    pub failed_tasks: usize,
    pub completion_percentage: f64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub lines_changed: u64,
    pub lines_of_code: u64,
    pub total_commits: u64,
    pub total_pull_requests: u64,
    pub total_messages: u64,
    pub total_sessions: u64,
    pub total_tests: u64,
    pub total_agents: u32,
    pub total_parse_retries: u32,
    pub total_build_fix_attempts: u32,
    pub build_verify_failures: usize,
    pub execution_failures: usize,
    pub file_ops_failures: usize,
}

// ---------------------------------------------------------------------------
// TaskService
// ---------------------------------------------------------------------------

pub struct TaskService {
    store: Arc<RocksStore>,
    claim_locks: Mutex<HashMap<ProjectId, Arc<Mutex<()>>>>,
}

impl TaskService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self {
            store,
            claim_locks: Mutex::new(HashMap::new()),
        }
    }

    fn project_claim_lock(&self, project_id: &ProjectId) -> Arc<Mutex<()>> {
        let mut locks = self.claim_locks.lock().unwrap();
        locks.entry(*project_id).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    }

    pub fn transition_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        new_status: TaskStatus,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, new_status)?;
        task.status = new_status;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn validate_transition(current: TaskStatus, target: TaskStatus) -> Result<(), TaskError> {
        let legal = matches!(
            (current, target),
            (TaskStatus::Pending, TaskStatus::Ready)
                | (TaskStatus::Ready, TaskStatus::InProgress)
                | (TaskStatus::InProgress, TaskStatus::Done)
                | (TaskStatus::InProgress, TaskStatus::Failed)
                | (TaskStatus::InProgress, TaskStatus::Blocked)
                | (TaskStatus::InProgress, TaskStatus::Ready)
                | (TaskStatus::Failed, TaskStatus::Ready)
                | (TaskStatus::Blocked, TaskStatus::Ready)
                | (TaskStatus::Done, TaskStatus::Ready)
        );
        if legal {
            Ok(())
        } else {
            Err(TaskError::IllegalTransition { current, target })
        }
    }

    /// Reset a single in-progress task back to `Ready`, clearing its agent
    /// assignment. Used when a task is interrupted by pause/stop mid-execution.
    pub fn reset_task_to_ready(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Ready)?;
        task.status = TaskStatus::Ready;
        task.assigned_agent_instance_id = None;
        task.session_id = None;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    /// Reset any orphaned `InProgress` tasks back to `Ready`.
    /// Called on loop start to recover from crashes or unclean shutdowns.
    pub fn reset_in_progress_tasks(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let mut reset = Vec::new();
        for task in &all_tasks {
            if task.status == TaskStatus::InProgress {
                let ready_task = self.transition_task(
                    project_id,
                    &task.spec_id,
                    &task.task_id,
                    TaskStatus::Ready,
                )?;
                reset.push(ready_task);
            }
        }
        Ok(reset)
    }

    pub fn assign_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        agent_instance_id: &AgentInstanceId,
        session_id: Option<SessionId>,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::InProgress)?;
        task.status = TaskStatus::InProgress;
        task.assigned_agent_instance_id = Some(*agent_instance_id);
        task.session_id = session_id;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn complete_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        notes: &str,
        files_changed: Vec<FileChangeSummary>,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Done)?;
        task.status = TaskStatus::Done;
        task.execution_notes = notes.to_string();
        task.files_changed = files_changed;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn fail_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        reason: &str,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Failed)?;
        task.status = TaskStatus::Failed;
        task.execution_notes = reason.to_string();
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn retry_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;

        if task.status == TaskStatus::Ready {
            return Ok(task);
        }

        Self::validate_transition(task.status, TaskStatus::Ready)?;
        task.status = TaskStatus::Ready;
        task.assigned_agent_instance_id = None;
        task.session_id = None;
        task.build_steps.clear();
        task.test_steps.clear();
        task.live_output.clear();
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    // -- Dependency resolution --

    pub fn resolve_dependencies_after_completion(
        &self,
        project_id: &ProjectId,
        completed_task_id: &TaskId,
    ) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let mut newly_ready = Vec::new();

        for task in &all_tasks {
            if task.status != TaskStatus::Pending {
                continue;
            }
            if !task.dependency_ids.contains(completed_task_id) {
                continue;
            }
            let all_deps_done = task.dependency_ids.iter().all(|dep_id| {
                all_tasks
                    .iter()
                    .find(|t| &t.task_id == dep_id)
                    .is_some_and(|t| t.status == TaskStatus::Done)
            });
            if all_deps_done {
                let ready_task = self.transition_task(
                    project_id,
                    &task.spec_id,
                    &task.task_id,
                    TaskStatus::Ready,
                )?;
                newly_ready.push(ready_task);
            }
        }
        Ok(newly_ready)
    }

    /// Detect cycles using Kahn's algorithm. Returns error if a cycle exists.
    pub fn detect_cycles(tasks: &[Task]) -> Result<(), TaskError> {
        let task_ids: HashSet<TaskId> = tasks.iter().map(|t| t.task_id).collect();
        let mut in_degree: HashMap<TaskId, usize> = HashMap::new();
        let mut adj: HashMap<TaskId, Vec<TaskId>> = HashMap::new();

        for task in tasks {
            in_degree.entry(task.task_id).or_insert(0);
            adj.entry(task.task_id).or_default();
            for dep_id in &task.dependency_ids {
                if task_ids.contains(dep_id) {
                    adj.entry(*dep_id).or_default().push(task.task_id);
                    *in_degree.entry(task.task_id).or_insert(0) += 1;
                }
            }
        }

        let mut queue: VecDeque<TaskId> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        let mut sorted_count = 0;

        while let Some(node) = queue.pop_front() {
            sorted_count += 1;
            if let Some(neighbors) = adj.get(&node) {
                for &neighbor in neighbors {
                    if let Some(deg) = in_degree.get_mut(&neighbor) {
                        *deg -= 1;
                        if *deg == 0 {
                            queue.push_back(neighbor);
                        }
                    }
                }
            }
        }

        if sorted_count < task_ids.len() {
            Err(TaskError::CycleDetected)
        } else {
            Ok(())
        }
    }

    /// Promote any Pending tasks with no (or all-done) dependencies to Ready.
    /// Called at loop start to fix tasks that were stored as Pending without
    /// an initial readiness pass.
    pub fn resolve_initial_readiness(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let done_ids: HashSet<TaskId> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Done)
            .map(|t| t.task_id)
            .collect();

        let mut promoted = Vec::new();
        for task in &all_tasks {
            if task.status != TaskStatus::Pending {
                continue;
            }
            let deps_satisfied = task.dependency_ids.is_empty()
                || task.dependency_ids.iter().all(|d| done_ids.contains(d));
            if deps_satisfied {
                let ready_task = self.transition_task(
                    project_id,
                    &task.spec_id,
                    &task.task_id,
                    TaskStatus::Ready,
                )?;
                promoted.push(ready_task);
            }
        }
        Ok(promoted)
    }

    // -- Next-task selection --

    pub fn select_next_task(&self, project_id: &ProjectId) -> Result<Option<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let specs = self.store.list_specs_by_project(project_id)?;

        let spec_order: HashMap<SpecId, u32> =
            specs.iter().map(|s| (s.spec_id, s.order_index)).collect();

        let mut ready: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Ready)
            .collect();

        ready.sort_by(|a, b| {
            let spec_ord_a = spec_order.get(&a.spec_id).copied().unwrap_or(u32::MAX);
            let spec_ord_b = spec_order.get(&b.spec_id).copied().unwrap_or(u32::MAX);
            spec_ord_a
                .cmp(&spec_ord_b)
                .then(a.order_index.cmp(&b.order_index))
        });

        Ok(ready.first().cloned().cloned())
    }

    /// Atomically select the next ready task and assign it to an agent.
    /// Uses a per-project mutex so two agents can never claim the same task.
    pub fn claim_next_task(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: Option<SessionId>,
    ) -> Result<Option<Task>, TaskError> {
        let lock = self.project_claim_lock(project_id);
        let _guard = lock.lock().unwrap();

        let task = self.select_next_task(project_id)?;
        match task {
            Some(t) => {
                let assigned = self.assign_task(project_id, &t.spec_id, &t.task_id, agent_instance_id, session_id)?;
                Ok(Some(assigned))
            }
            None => Ok(None),
        }
    }

    // -- Follow-up task creation --

    pub fn create_follow_up_task(
        &self,
        originating_task: &Task,
        title: String,
        description: String,
        dependency_ids: Vec<TaskId>,
    ) -> Result<Task, TaskError> {
        let existing = self
            .store
            .list_tasks_by_spec(&originating_task.project_id, &originating_task.spec_id)?;
        let norm_title = title.trim().to_lowercase();
        if existing.iter().any(|t| t.title.trim().to_lowercase() == norm_title) {
            return Err(TaskError::DuplicateFollowUp);
        }

        let now = Utc::now();
        let task = Task {
            task_id: TaskId::new(),
            project_id: originating_task.project_id,
            spec_id: originating_task.spec_id,
            title,
            description,
            status: if dependency_ids.is_empty() {
                TaskStatus::Ready
            } else {
                TaskStatus::Pending
            },
            order_index: originating_task.order_index + 1,
            dependency_ids,
            parent_task_id: Some(originating_task.task_id),
            assigned_agent_instance_id: None,
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
        };
        self.store.put_task(&task)?;
        Ok(task)
    }

    // -- Progress --

    pub fn get_project_progress(
        &self,
        project_id: &ProjectId,
    ) -> Result<ProjectProgress, TaskError> {
        let tasks = self.store.list_tasks_by_project(project_id)?;
        let total = tasks.len();
        let done = tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Done)
            .count();
        let pct = if total == 0 {
            0.0
        } else {
            (done as f64 / total as f64) * 100.0
        };

        let lines_changed: u64 = tasks
            .iter()
            .flat_map(|t| &t.files_changed)
            .map(|f| (f.lines_added as u64) + (f.lines_removed as u64))
            .sum();

        let task_input: u64 = tasks.iter().map(|t| t.total_input_tokens).sum();
        let task_output: u64 = tasks.iter().map(|t| t.total_output_tokens).sum();

        let pricing = aura_billing::PricingService::new(self.store.clone());
        let fee_schedule = pricing.get_fee_schedule();

        let total_parse_retries: u32 = tasks
            .iter()
            .flat_map(|t| &t.build_steps)
            .filter(|s| s.kind == "fix_attempt")
            .count() as u32;

        let total_build_fix_attempts: u32 = tasks
            .iter()
            .map(|t| {
                t.build_steps
                    .iter()
                    .filter(|s| s.kind == "fix_attempt")
                    .count() as u32
            })
            .sum();

        let failed_tasks: Vec<&Task> = tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Failed)
            .collect();

        let build_verify_failures = failed_tasks
            .iter()
            .filter(|t| {
                t.execution_notes
                    .contains("build verification failed")
            })
            .count();

        let file_ops_failures = failed_tasks
            .iter()
            .filter(|t| t.execution_notes.contains("file operation failed"))
            .count();

        let execution_failures = failed_tasks.len() - build_verify_failures - file_ops_failures;

        Ok(ProjectProgress {
            project_id: *project_id,
            total_tasks: total,
            pending_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Pending)
                .count(),
            ready_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Ready)
                .count(),
            in_progress_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::InProgress)
                .count(),
            blocked_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Blocked)
                .count(),
            done_tasks: done,
            failed_tasks: failed_tasks.len(),
            completion_percentage: pct,
            total_tokens: task_input + task_output,
            total_cost: tasks.iter().map(|t| {
                let model = t.model.as_deref().unwrap_or("claude-opus-4-6");
                let (inp_rate, out_rate) = aura_billing::lookup_rate_in(&fee_schedule, model);
                aura_billing::compute_cost_with_rates(
                    t.total_input_tokens, t.total_output_tokens, inp_rate, out_rate,
                )
            }).sum(),
            lines_changed,
            lines_of_code: 0,
            total_commits: 0,
            total_pull_requests: 0,
            total_messages: 0,
            total_sessions: 0,
            total_tests: 0,
            total_agents: 0,
            total_parse_retries,
            total_build_fix_attempts,
            build_verify_failures,
            execution_failures,
            file_ops_failures,
        })
    }
}

// ---------------------------------------------------------------------------
// TaskExtractionService
// ---------------------------------------------------------------------------

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
