use chrono::Utc;
use std::path::Path;

use crate::entities::*;
use crate::enums::*;
use crate::ids::*;

pub fn make_project(name: &str, _folder: &str) -> Project {
    let now = Utc::now();
    Project {
        project_id: ProjectId::new(),
        org_id: OrgId::new(),
        name: name.to_string(),
        description: String::new(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Active,
        build_command: None,
        test_command: None,
        specs_summary: None,
        specs_title: None,
        created_at: now,
        updated_at: now,
        git_repo_url: None,
        git_branch: None,
        orbit_base_url: None,
        orbit_owner: None,
        orbit_repo: None,
    }
}

pub fn make_task(title: &str, desc: &str) -> Task {
    let now = Utc::now();
    Task {
        task_id: TaskId::new(),
        project_id: ProjectId::new(),
        spec_id: SpecId::new(),
        title: title.to_string(),
        description: desc.to_string(),
        status: TaskStatus::Pending,
        order_index: 0,
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
    }
}

pub fn make_spec(content: &str) -> Spec {
    let now = Utc::now();
    Spec {
        spec_id: SpecId::new(),
        project_id: ProjectId::new(),
        title: String::new(),
        order_index: 0,
        markdown_contents: content.to_string(),
        created_at: now,
        updated_at: now,
    }
}

pub fn make_session() -> Session {
    Session {
        session_id: SessionId::new(),
        agent_instance_id: AgentInstanceId::new(),
        project_id: ProjectId::new(),
        active_task_id: None,
        tasks_worked: vec![],
        context_usage_estimate: 0.0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        summary_of_previous_context: String::new(),
        status: SessionStatus::Active,
        user_id: None,
        model: None,
        started_at: Utc::now(),
        ended_at: None,
    }
}

pub fn make_agent_instance(name: &str) -> AgentInstance {
    let now = Utc::now();
    AgentInstance {
        agent_instance_id: AgentInstanceId::new(),
        project_id: ProjectId::new(),
        agent_id: AgentId::new(),
        name: name.to_string(),
        role: String::new(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        workspace_path: None,
        status: AgentStatus::Idle,
        current_task_id: None,
        current_session_id: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        model: None,
        created_at: now,
        updated_at: now,
    }
}

pub struct TestProject {
    pub dir: tempfile::TempDir,
    pub project: Project,
}

impl TestProject {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("failed to create temp dir");
        let project = make_project("test-project", dir.path().to_str().unwrap());
        Self { dir, project }
    }

    pub fn write_file(&self, rel: &str, content: &str) {
        let path = self.dir.path().join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create parent dirs");
        }
        std::fs::write(&path, content).expect("failed to write file");
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }
}
