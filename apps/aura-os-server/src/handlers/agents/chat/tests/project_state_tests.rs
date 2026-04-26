//! Tests for the project-state snapshot formatter.

use aura_os_core::{parse_dt, ProjectId, Spec, Task, TaskStatus};

use super::super::compaction::{
    append_project_state_to_system_prompt, format_project_state_snapshot,
};

fn spec(title: &str, order_index: u32) -> Spec {
    Spec {
        spec_id: aura_os_core::SpecId::new(),
        project_id: ProjectId::nil(),
        title: title.to_string(),
        order_index,
        markdown_contents: String::new(),
        created_at: parse_dt(&None),
        updated_at: parse_dt(&None),
    }
}

fn task(title: &str, spec_id: aura_os_core::SpecId) -> Task {
    Task {
        task_id: aura_os_core::TaskId::new(),
        project_id: ProjectId::nil(),
        spec_id,
        title: title.to_string(),
        description: String::new(),
        status: TaskStatus::Backlog,
        order_index: 0,
        dependency_ids: Vec::new(),
        parent_task_id: None,
        skip_auto_decompose: false,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: Vec::new(),
        live_output: String::new(),
        build_steps: Vec::new(),
        test_steps: Vec::new(),
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: parse_dt(&None),
        updated_at: parse_dt(&None),
    }
}

#[test]
fn project_state_snapshot_formats_recent_specs_and_tasks() {
    let lemonade = spec("01: Make Lemonade", 1);
    let tea = spec("02: Make Tea", 2);
    let tasks = vec![
        task("Gather ingredients and tools", lemonade.spec_id),
        task("Juice and mix lemonade", lemonade.spec_id),
        task("Boil water", tea.spec_id),
    ];

    let snapshot = format_project_state_snapshot(&[lemonade.clone(), tea.clone()], &tasks)
        .expect("snapshot should be produced");

    assert!(snapshot.contains("Recent specs:"));
    assert!(snapshot.contains("01: Make Lemonade"));
    assert!(snapshot.contains("Recent tasks:"));
    assert!(snapshot.contains("Gather ingredients and tools"));
    assert!(snapshot.contains("(spec: 01: Make Lemonade)"));
}

#[test]
fn project_state_snapshot_prompt_appends_snapshot_safely() {
    let prompt = append_project_state_to_system_prompt(
        "You are a helpful coding agent.",
        Some("Current durable project state from persisted Aura records:\nRecent specs:\n- 01: Make Lemonade"),
    );

    assert!(prompt.contains("You are a helpful coding agent."));
    assert!(prompt.contains("persisted Aura records"));
    assert!(prompt.contains("01: Make Lemonade"));
}
