use std::str::FromStr;

use aura_core::*;
use chrono::Utc;

// ---------------------------------------------------------------------------
// ID round-trips
// ---------------------------------------------------------------------------

macro_rules! test_id_round_trip {
    ($name:ident, $type:ty) => {
        mod $name {
            use super::*;

            #[test]
            fn new_produces_unique_ids() {
                let a = <$type>::new();
                let b = <$type>::new();
                assert_ne!(a, b);
            }

            #[test]
            fn display_and_from_str_round_trip() {
                let id = <$type>::new();
                let s = id.to_string();
                let parsed = <$type>::from_str(&s).expect("parse failed");
                assert_eq!(id, parsed);
            }

            #[test]
            fn serde_json_round_trip() {
                let id = <$type>::new();
                let json = serde_json::to_string(&id).expect("serialize failed");
                let back: $type = serde_json::from_str(&json).expect("deserialize failed");
                assert_eq!(id, back);
            }

            #[test]
            fn debug_contains_type_name() {
                let id = <$type>::new();
                let dbg = format!("{:?}", id);
                assert!(dbg.starts_with(stringify!($type)));
            }
        }
    };
}

test_id_round_trip!(project_id, ProjectId);
test_id_round_trip!(spec_id, SpecId);
test_id_round_trip!(task_id, TaskId);
test_id_round_trip!(agent_id, AgentId);
test_id_round_trip!(session_id, SessionId);

// ---------------------------------------------------------------------------
// Enum serde round-trips
// ---------------------------------------------------------------------------

macro_rules! test_enum_variant {
    ($test_name:ident, $variant:expr, $expected_json:expr) => {
        #[test]
        fn $test_name() {
            let json = serde_json::to_string(&$variant).expect("serialize failed");
            assert_eq!(json, format!("\"{}\"", $expected_json));
            let back = serde_json::from_str(&json).expect("deserialize failed");
            assert_eq!($variant, back);
        }
    };
}

mod project_status_serde {
    use super::*;
    test_enum_variant!(planning, ProjectStatus::Planning, "planning");
    test_enum_variant!(active, ProjectStatus::Active, "active");
    test_enum_variant!(paused, ProjectStatus::Paused, "paused");
    test_enum_variant!(completed, ProjectStatus::Completed, "completed");
    test_enum_variant!(archived, ProjectStatus::Archived, "archived");
}

mod task_status_serde {
    use super::*;
    test_enum_variant!(pending, TaskStatus::Pending, "pending");
    test_enum_variant!(ready, TaskStatus::Ready, "ready");
    test_enum_variant!(in_progress, TaskStatus::InProgress, "in_progress");
    test_enum_variant!(blocked, TaskStatus::Blocked, "blocked");
    test_enum_variant!(done, TaskStatus::Done, "done");
    test_enum_variant!(failed, TaskStatus::Failed, "failed");
}

mod agent_status_serde {
    use super::*;
    test_enum_variant!(idle, AgentStatus::Idle, "idle");
    test_enum_variant!(working, AgentStatus::Working, "working");
    test_enum_variant!(blocked, AgentStatus::Blocked, "blocked");
    test_enum_variant!(stopped, AgentStatus::Stopped, "stopped");
    test_enum_variant!(error, AgentStatus::Error, "error");
}

mod session_status_serde {
    use super::*;
    test_enum_variant!(active, SessionStatus::Active, "active");
    test_enum_variant!(completed, SessionStatus::Completed, "completed");
    test_enum_variant!(failed, SessionStatus::Failed, "failed");
    test_enum_variant!(rolled_over, SessionStatus::RolledOver, "rolled_over");
}

// ---------------------------------------------------------------------------
// Entity struct serde round-trips
// ---------------------------------------------------------------------------

fn sample_project() -> Project {
    let now = Utc::now();
    Project {
        project_id: ProjectId::new(),
        org_id: OrgId::new(),
        name: "Test Project".into(),
        description: "A test project".into(),
        linked_folder_path: "/tmp/code".into(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        github_integration_id: None,
        github_repo_full_name: None,
        build_command: None,
        test_command: None,
        specs_summary: None,
        specs_title: None,
        created_at: now,
        updated_at: now,
    }
}

fn sample_spec(project_id: ProjectId) -> Spec {
    let now = Utc::now();
    Spec {
        spec_id: SpecId::new(),
        project_id,
        title: "Core Domain Types".into(),
        order_index: 0,
        markdown_contents: "# Spec 01\nDetails...".into(),
        sprint_id: None,
        created_at: now,
        updated_at: now,
    }
}

fn sample_task(project_id: ProjectId, spec_id: SpecId) -> Task {
    let now = Utc::now();
    Task {
        task_id: TaskId::new(),
        project_id,
        spec_id,
        title: "Implement IDs".into(),
        description: "Create newtype IDs".into(),
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

fn sample_agent() -> Agent {
    let now = Utc::now();
    Agent {
        agent_id: AgentId::new(),
        user_id: "user-1".into(),
        name: "Agent-1".into(),
        role: "Engineer".into(),
        personality: "Helpful".into(),
        system_prompt: "You are a helpful engineer.".into(),
        skills: vec![],
        icon: None,
        created_at: now,
        updated_at: now,
    }
}

fn sample_agent_instance(project_id: ProjectId, agent_id: AgentId) -> AgentInstance {
    let now = Utc::now();
    AgentInstance {
        agent_instance_id: AgentInstanceId::new(),
        project_id,
        agent_id,
        name: "Agent-1".into(),
        role: "Engineer".into(),
        personality: "Helpful".into(),
        system_prompt: "You are a helpful engineer.".into(),
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

fn sample_session(agent_instance_id: AgentInstanceId, project_id: ProjectId) -> Session {
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

macro_rules! test_entity_round_trip {
    ($test_name:ident, $entity:expr) => {
        #[test]
        fn $test_name() {
            let entity = $entity;
            let json = serde_json::to_string_pretty(&entity).expect("serialize failed");
            let back = serde_json::from_str(&json).expect("deserialize failed");
            assert_eq!(entity, back);
        }
    };
}

test_entity_round_trip!(project_round_trip, sample_project());
test_entity_round_trip!(spec_round_trip, {
    let p = sample_project();
    sample_spec(p.project_id)
});
test_entity_round_trip!(task_round_trip, {
    let p = sample_project();
    let s = sample_spec(p.project_id);
    sample_task(p.project_id, s.spec_id)
});
test_entity_round_trip!(agent_round_trip, {
    sample_agent()
});
test_entity_round_trip!(agent_instance_round_trip, {
    let p = sample_project();
    let a = sample_agent();
    sample_agent_instance(p.project_id, a.agent_id)
});
test_entity_round_trip!(session_round_trip, {
    let p = sample_project();
    let a = sample_agent();
    let instance = sample_agent_instance(p.project_id, a.agent_id);
    sample_session(instance.agent_instance_id, p.project_id)
});
