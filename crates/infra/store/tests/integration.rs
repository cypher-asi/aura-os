use aura_core::*;
use aura_store::*;
use chrono::Utc;
use tempfile::TempDir;

fn open_temp_store() -> (RocksStore, TempDir) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let store = RocksStore::open(dir.path()).expect("failed to open store");
    (store, dir)
}

fn make_project() -> Project {
    let now = Utc::now();
    Project {
        project_id: ProjectId::new(),
        org_id: OrgId::new(),
        name: "Test Project".into(),
        description: "Integration test project".into(),
        linked_folder_path: "/tmp/code".into(),
        workspace_source: None,
        workspace_display_path: None,
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        build_command: None,
        test_command: None,
        specs_summary: None,
        specs_title: None,
        created_at: now,
        updated_at: now,
    }
}

fn make_spec(project_id: ProjectId) -> Spec {
    let now = Utc::now();
    Spec {
        spec_id: SpecId::new(),
        project_id,
        title: "Test Spec".into(),
        order_index: 0,
        markdown_contents: "# Spec\nTest contents".into(),
        created_at: now,
        updated_at: now,
    }
}

fn make_task(project_id: ProjectId, spec_id: SpecId) -> Task {
    let now = Utc::now();
    Task {
        task_id: TaskId::new(),
        project_id,
        spec_id,
        title: "Test Task".into(),
        description: "A test task".into(),
        status: TaskStatus::Pending,
        order_index: 1,
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

const TEST_USER_ID: &str = "test-user-001";

fn make_agent() -> Agent {
    let now = Utc::now();
    Agent {
        agent_id: AgentId::new(),
        user_id: TEST_USER_ID.into(),
        name: "Agent-1".into(),
        role: "developer".into(),
        personality: "helpful".into(),
        system_prompt: "You are a test agent.".into(),
        skills: vec![],
        icon: None,
        network_agent_id: None,
        profile_id: None,
        created_at: now,
        updated_at: now,
    }
}

fn make_agent_instance(project_id: ProjectId, agent_id: AgentId) -> AgentInstance {
    let now = Utc::now();
    AgentInstance {
        agent_instance_id: AgentInstanceId::new(),
        project_id,
        agent_id,
        name: "Agent-1".into(),
        role: "developer".into(),
        personality: "helpful".into(),
        system_prompt: "You are a test agent instance.".into(),
        skills: vec![],
        icon: None,
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

fn make_session(agent_instance_id: AgentInstanceId, project_id: ProjectId) -> Session {
    let now = Utc::now();
    Session {
        session_id: SessionId::new(),
        agent_instance_id,
        project_id,
        active_task_id: None,
        tasks_worked: Vec::new(),
        context_usage_estimate: 0.0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        summary_of_previous_context: String::new(),
        status: SessionStatus::Active,
        user_id: None,
        model: None,
        started_at: now,
        ended_at: None,
    }
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

#[test]
fn project_crud_round_trip() {
    let (store, _dir) = open_temp_store();
    let project = make_project();

    store.put_project(&project).unwrap();
    let fetched = store.get_project(&project.project_id).unwrap();
    assert_eq!(project, fetched);

    let mut updated = project.clone();
    updated.name = "Updated Name".into();
    updated.updated_at = Utc::now();
    store.put_project(&updated).unwrap();
    let fetched = store.get_project(&updated.project_id).unwrap();
    assert_eq!(fetched.name, "Updated Name");

    store.delete_project(&updated.project_id).unwrap();
    let result = store.get_project(&updated.project_id);
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn list_projects_returns_all() {
    let (store, _dir) = open_temp_store();
    let p1 = make_project();
    let p2 = make_project();
    store.put_project(&p1).unwrap();
    store.put_project(&p2).unwrap();

    let projects = store.list_projects().unwrap();
    assert_eq!(projects.len(), 2);
}

// ---------------------------------------------------------------------------
// Spec CRUD
// ---------------------------------------------------------------------------

#[test]
fn spec_crud_round_trip() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    store.put_project(&project).unwrap();

    let spec = make_spec(project.project_id);
    store.put_spec(&spec).unwrap();

    let fetched = store.get_spec(&project.project_id, &spec.spec_id).unwrap();
    assert_eq!(spec, fetched);

    store
        .delete_spec(&project.project_id, &spec.spec_id)
        .unwrap();
    let result = store.get_spec(&project.project_id, &spec.spec_id);
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn list_specs_by_project_filters_correctly() {
    let (store, _dir) = open_temp_store();
    let p1 = make_project();
    let p2 = make_project();
    store.put_project(&p1).unwrap();
    store.put_project(&p2).unwrap();

    let s1 = make_spec(p1.project_id);
    let s2 = make_spec(p1.project_id);
    let s3 = make_spec(p2.project_id);
    store.put_spec(&s1).unwrap();
    store.put_spec(&s2).unwrap();
    store.put_spec(&s3).unwrap();

    let specs_p1 = store.list_specs_by_project(&p1.project_id).unwrap();
    assert_eq!(specs_p1.len(), 2);
    for s in &specs_p1 {
        assert_eq!(s.project_id, p1.project_id);
    }

    let specs_p2 = store.list_specs_by_project(&p2.project_id).unwrap();
    assert_eq!(specs_p2.len(), 1);
    assert_eq!(specs_p2[0].project_id, p2.project_id);
}

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

#[test]
fn task_crud_round_trip() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let spec = make_spec(project.project_id);
    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();

    let task = make_task(project.project_id, spec.spec_id);
    store.put_task(&task).unwrap();

    let fetched = store
        .get_task(&project.project_id, &spec.spec_id, &task.task_id)
        .unwrap();
    assert_eq!(task, fetched);

    store
        .delete_task(&project.project_id, &spec.spec_id, &task.task_id)
        .unwrap();
    let result = store.get_task(&project.project_id, &spec.spec_id, &task.task_id);
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn list_tasks_by_spec_filters_correctly() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let s1 = make_spec(project.project_id);
    let s2 = make_spec(project.project_id);
    store.put_project(&project).unwrap();
    store.put_spec(&s1).unwrap();
    store.put_spec(&s2).unwrap();

    let t1 = make_task(project.project_id, s1.spec_id);
    let t2 = make_task(project.project_id, s1.spec_id);
    let t3 = make_task(project.project_id, s2.spec_id);
    store.put_task(&t1).unwrap();
    store.put_task(&t2).unwrap();
    store.put_task(&t3).unwrap();

    let tasks_s1 = store
        .list_tasks_by_spec(&project.project_id, &s1.spec_id)
        .unwrap();
    assert_eq!(tasks_s1.len(), 2);

    let tasks_s2 = store
        .list_tasks_by_spec(&project.project_id, &s2.spec_id)
        .unwrap();
    assert_eq!(tasks_s2.len(), 1);
}

#[test]
fn list_tasks_by_project_returns_all_tasks() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let s1 = make_spec(project.project_id);
    let s2 = make_spec(project.project_id);
    store.put_project(&project).unwrap();
    store.put_spec(&s1).unwrap();
    store.put_spec(&s2).unwrap();

    let t1 = make_task(project.project_id, s1.spec_id);
    let t2 = make_task(project.project_id, s2.spec_id);
    store.put_task(&t1).unwrap();
    store.put_task(&t2).unwrap();

    let all_tasks = store.list_tasks_by_project(&project.project_id).unwrap();
    assert_eq!(all_tasks.len(), 2);
}

// ---------------------------------------------------------------------------
// Agent CRUD (user-scoped)
// ---------------------------------------------------------------------------

#[test]
fn agent_crud_round_trip() {
    let (store, _dir) = open_temp_store();

    let agent = make_agent();
    store.put_agent(&agent).unwrap();

    let fetched = store
        .get_agent(&agent.user_id, &agent.agent_id)
        .unwrap();
    assert_eq!(agent, fetched);

    store
        .delete_agent(&agent.user_id, &agent.agent_id)
        .unwrap();
    let result = store.get_agent(&agent.user_id, &agent.agent_id);
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn list_agents_by_user_filters_correctly() {
    let (store, _dir) = open_temp_store();

    let a1 = make_agent();
    let mut a2 = make_agent();
    a2.user_id = "other-user".into();
    store.put_agent(&a1).unwrap();
    store.put_agent(&a2).unwrap();

    let agents = store.list_agents_by_user(TEST_USER_ID).unwrap();
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].user_id, TEST_USER_ID);
}

// ---------------------------------------------------------------------------
// AgentInstance CRUD (project-scoped)
// ---------------------------------------------------------------------------

#[test]
fn agent_instance_crud_round_trip() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let agent = make_agent();
    store.put_project(&project).unwrap();
    store.put_agent(&agent).unwrap();

    let instance = make_agent_instance(project.project_id, agent.agent_id);
    store.put_agent_instance(&instance).unwrap();

    let fetched = store
        .get_agent_instance(&project.project_id, &instance.agent_instance_id)
        .unwrap();
    assert_eq!(instance, fetched);

    store
        .delete_agent_instance(&project.project_id, &instance.agent_instance_id)
        .unwrap();
    let result = store.get_agent_instance(&project.project_id, &instance.agent_instance_id);
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn list_agent_instances_by_project_filters_correctly() {
    let (store, _dir) = open_temp_store();
    let p1 = make_project();
    let p2 = make_project();
    let agent = make_agent();
    store.put_project(&p1).unwrap();
    store.put_project(&p2).unwrap();
    store.put_agent(&agent).unwrap();

    let i1 = make_agent_instance(p1.project_id, agent.agent_id);
    let i2 = make_agent_instance(p2.project_id, agent.agent_id);
    store.put_agent_instance(&i1).unwrap();
    store.put_agent_instance(&i2).unwrap();

    let instances = store.list_agent_instances_by_project(&p1.project_id).unwrap();
    assert_eq!(instances.len(), 1);
    assert_eq!(instances[0].project_id, p1.project_id);
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

#[test]
fn session_crud_round_trip() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let agent = make_agent();
    store.put_project(&project).unwrap();
    store.put_agent(&agent).unwrap();

    let instance = make_agent_instance(project.project_id, agent.agent_id);
    store.put_agent_instance(&instance).unwrap();

    let session = make_session(instance.agent_instance_id, project.project_id);
    store.put_session(&session).unwrap();

    let fetched = store
        .get_session(&project.project_id, &instance.agent_instance_id, &session.session_id)
        .unwrap();
    assert_eq!(session, fetched);

    store
        .delete_session(&project.project_id, &instance.agent_instance_id, &session.session_id)
        .unwrap();
    let result = store.get_session(&project.project_id, &instance.agent_instance_id, &session.session_id);
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

#[test]
fn list_sessions_by_agent_filters_correctly() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let agent = make_agent();
    store.put_project(&project).unwrap();
    store.put_agent(&agent).unwrap();

    let i1 = make_agent_instance(project.project_id, agent.agent_id);
    let i2 = make_agent_instance(project.project_id, agent.agent_id);
    store.put_agent_instance(&i1).unwrap();
    store.put_agent_instance(&i2).unwrap();

    let s1 = make_session(i1.agent_instance_id, project.project_id);
    let s2 = make_session(i1.agent_instance_id, project.project_id);
    let s3 = make_session(i2.agent_instance_id, project.project_id);
    store.put_session(&s1).unwrap();
    store.put_session(&s2).unwrap();
    store.put_session(&s3).unwrap();

    let sessions = store
        .list_sessions_by_agent(&project.project_id, &i1.agent_instance_id)
        .unwrap();
    assert_eq!(sessions.len(), 2);
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

#[test]
fn settings_crud_round_trip() {
    let (store, _dir) = open_temp_store();

    store
        .put_setting("claude_api_key", b"sk-secret-123")
        .unwrap();
    let val = store.get_setting("claude_api_key").unwrap();
    assert_eq!(val, b"sk-secret-123");

    store.delete_setting("claude_api_key").unwrap();
    let result = store.get_setting("claude_api_key");
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}

// ---------------------------------------------------------------------------
// Batch writes
// ---------------------------------------------------------------------------

#[test]
fn batch_write_is_atomic() {
    let (store, _dir) = open_temp_store();
    let project = make_project();
    let spec = make_spec(project.project_id);
    let t1 = make_task(project.project_id, spec.spec_id);
    let t2 = make_task(project.project_id, spec.spec_id);

    let ops = vec![
        BatchOp::Put {
            cf: ColumnFamilyName::Projects,
            key: project.project_id.to_string(),
            value: serde_json::to_vec(&project).unwrap(),
        },
        BatchOp::Put {
            cf: ColumnFamilyName::Specs,
            key: format!("{}:{}", spec.project_id, spec.spec_id),
            value: serde_json::to_vec(&spec).unwrap(),
        },
        BatchOp::Put {
            cf: ColumnFamilyName::Tasks,
            key: format!("{}:{}:{}", t1.project_id, t1.spec_id, t1.task_id),
            value: serde_json::to_vec(&t1).unwrap(),
        },
        BatchOp::Put {
            cf: ColumnFamilyName::Tasks,
            key: format!("{}:{}:{}", t2.project_id, t2.spec_id, t2.task_id),
            value: serde_json::to_vec(&t2).unwrap(),
        },
    ];

    store.write_batch(ops).unwrap();

    let fetched_project = store.get_project(&project.project_id).unwrap();
    assert_eq!(fetched_project, project);

    let fetched_spec = store.get_spec(&project.project_id, &spec.spec_id).unwrap();
    assert_eq!(fetched_spec, spec);

    let tasks = store
        .list_tasks_by_spec(&project.project_id, &spec.spec_id)
        .unwrap();
    assert_eq!(tasks.len(), 2);
}

// ---------------------------------------------------------------------------
// Reopen persistence
// ---------------------------------------------------------------------------

#[test]
fn data_persists_across_reopen() {
    let dir = TempDir::new().expect("failed to create temp dir");
    let project = make_project();

    {
        let store = RocksStore::open(dir.path()).unwrap();
        store.put_project(&project).unwrap();
    }

    {
        let store = RocksStore::open(dir.path()).unwrap();
        let fetched = store.get_project(&project.project_id).unwrap();
        assert_eq!(fetched, project);
    }
}

// ---------------------------------------------------------------------------
// Not-found error
// ---------------------------------------------------------------------------

#[test]
fn get_missing_entity_returns_not_found() {
    let (store, _dir) = open_temp_store();
    let result = store.get_project(&ProjectId::new());
    assert!(matches!(result, Err(StoreError::NotFound(_))));
}
