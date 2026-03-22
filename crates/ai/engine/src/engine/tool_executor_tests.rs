use super::*;
use aura_claude::ToolCall;

fn make_executor() -> EngineToolLoopExecutor {
    use chrono::Utc;
    let now = Utc::now();

    let project = Project {
        project_id: ProjectId::new(),
        org_id: OrgId::new(),
        name: "test".into(),
        description: "test".into(),
        linked_folder_path: "/tmp/test-project".into(),
        workspace_source: None,
        workspace_display_path: None,
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
    };
    let spec = Spec {
        spec_id: SpecId::new(),
        project_id: project.project_id,
        title: "Test spec".into(),
        markdown_contents: "Spec content".into(),
        order_index: 0,
        created_at: now,
        updated_at: now,
    };
    let task = Task {
        task_id: TaskId::new(),
        project_id: project.project_id,
        spec_id: spec.spec_id,
        title: "Test task".into(),
        description: "Do the thing".into(),
        status: TaskStatus::InProgress,
        order_index: 0,
        dependency_ids: vec![],
        parent_task_id: None,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: vec![],
        build_steps: vec![],
        test_steps: vec![],
        live_output: String::new(),
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: now,
        updated_at: now,
    };
    let session = Session::dummy(project.project_id);

    let (engine_event_tx, _rx) = mpsc::unbounded_channel();

    let store = Arc::new(aura_store::RocksStore::open(
        tempfile::TempDir::new().unwrap().path(),
    ).unwrap());
    let project_service = Arc::new(aura_projects::ProjectService::new(store.clone()));
    let task_service = Arc::new(aura_tasks::TaskService::new(
        store.clone(), None,
    ));

    EngineToolLoopExecutor {
        inner: ChatToolExecutor::new(
            store, None, project_service, task_service,
        ),
        project_id: project.project_id,
        project,
        spec,
        task,
        session,
        engine_event_tx,
        agent_instance_id: AgentInstanceId::new(),
        task_id: TaskId::new(),
        tracked_file_ops: Arc::new(Mutex::new(Vec::new())),
        notes: Arc::new(Mutex::new(String::new())),
        follow_ups: Arc::new(Mutex::new(Vec::new())),
        stub_fix_attempts: Arc::new(Mutex::new(0)),
        completed_deps: vec![],
        work_log_summary: String::new(),
        task_phase: Arc::new(Mutex::new(
            TaskPhase::Implementing {
                plan: TaskPlan::empty(),
            }
        )),
        self_review_done: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        files_read: Arc::new(Mutex::new(std::collections::HashSet::new())),
    }
}

#[test]
fn looks_like_compiler_errors_detects_rust() {
    let output = "error[E0308]: mismatched types\n --> src/main.rs:5:10\n";
    assert!(looks_like_compiler_errors(output));
}

#[test]
fn looks_like_compiler_errors_detects_generic() {
    let output = "error: cannot find value `x` in this scope\n --> src/lib.rs:3:5\n";
    assert!(looks_like_compiler_errors(output));
}

#[test]
fn looks_like_compiler_errors_detects_typescript() {
    let output = "src/App.tsx(5,3): error TS2304: Cannot find name 'foo'.\n";
    assert!(looks_like_compiler_errors(output));
}

#[test]
fn looks_like_compiler_errors_false_for_plain_text() {
    assert!(!looks_like_compiler_errors("Everything compiled successfully"));
    assert!(!looks_like_compiler_errors("error: something"));
    assert!(!looks_like_compiler_errors(""));
}

#[tokio::test]
async fn handle_task_done_extracts_notes_and_stops() {
    let exec = make_executor();
    let tc = ToolCall {
        id: "tool-1".into(),
        name: "task_done".into(),
        input: serde_json::json!({
            "notes": "Completed the implementation"
        }),
    };

    let mut results = Vec::new();
    let mut stop = false;
    exec.handle_task_done(&tc, &mut results, &mut stop).await;

    assert!(stop, "task_done should set stop=true");
    assert_eq!(results.len(), 1);
    assert!(results[0].stop_loop);
    assert!(!results[0].is_error);
    assert!(results[0].content.contains("completed"));

    let notes = exec.notes.lock().await;
    assert_eq!(*notes, "Completed the implementation");
}

#[tokio::test]
async fn handle_task_done_extracts_follow_ups() {
    let exec = make_executor();
    let tc = ToolCall {
        id: "tool-2".into(),
        name: "task_done".into(),
        input: serde_json::json!({
            "notes": "Done",
            "follow_ups": [
                {"title": "Add tests", "description": "Test the new feature"},
                {"title": "Update docs", "description": "Document the API"}
            ]
        }),
    };

    let mut results = Vec::new();
    let mut stop = false;
    exec.handle_task_done(&tc, &mut results, &mut stop).await;

    let follow_ups = exec.follow_ups.lock().await;
    assert_eq!(follow_ups.len(), 2);
    assert_eq!(follow_ups[0].title, "Add tests");
    assert_eq!(follow_ups[1].title, "Update docs");
}

#[test]
fn handle_get_context_returns_context_string() {
    let exec = make_executor();
    let tc = ToolCall {
        id: "tool-3".into(),
        name: "get_task_context".into(),
        input: serde_json::json!({}),
    };

    let mut results = Vec::new();
    exec.handle_get_context(&tc, &mut results);

    assert_eq!(results.len(), 1);
    assert!(!results[0].is_error);
    assert!(!results[0].stop_loop);
    assert!(results[0].content.contains("Test task") || results[0].content.contains("Test spec"));
}

#[tokio::test]
async fn execute_dispatches_task_done_stops_all_results() {
    let exec = make_executor();
    let tool_calls = vec![
        ToolCall {
            id: "t1".into(),
            name: "task_done".into(),
            input: serde_json::json!({"notes": "All done"}),
        },
    ];

    let results = exec.execute(&tool_calls).await;
    assert_eq!(results.len(), 1);
    assert!(results[0].stop_loop, "task_done should set stop_loop on all results");
}

#[tokio::test]
async fn execute_dispatches_get_task_context() {
    let exec = make_executor();
    let tool_calls = vec![
        ToolCall {
            id: "t1".into(),
            name: "get_task_context".into(),
            input: serde_json::json!({}),
        },
    ];

    let results = exec.execute(&tool_calls).await;
    assert_eq!(results.len(), 1);
    assert!(!results[0].is_error);
    assert!(!results[0].stop_loop);
}
