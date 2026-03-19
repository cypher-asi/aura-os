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
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
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

// Spec, task, agent instance, and session CRUD tests removed --
// these entities are fully migrated to aura-storage.

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
    let p1 = make_project();
    let p2 = make_project();

    let ops = vec![
        BatchOp::Put {
            cf: ColumnFamilyName::Projects,
            key: p1.project_id.to_string(),
            value: serde_json::to_vec(&p1).unwrap(),
        },
        BatchOp::Put {
            cf: ColumnFamilyName::Projects,
            key: p2.project_id.to_string(),
            value: serde_json::to_vec(&p2).unwrap(),
        },
    ];

    store.write_batch(ops).unwrap();

    let fetched = store.get_project(&p1.project_id).unwrap();
    assert_eq!(fetched, p1);

    let projects = store.list_projects().unwrap();
    assert_eq!(projects.len(), 2);
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
