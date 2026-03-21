use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use aura_core::*;
use aura_projects::ProjectService;
use aura_store::RocksStore;
use aura_tasks::TaskService;

use crate::chat_tool_executor::ChatToolExecutor;

struct TestHarness {
    executor: ChatToolExecutor,
    project_id: ProjectId,
    project_dir: TempDir,
    _store_dir: TempDir,
}

fn setup() -> TestHarness {
    let store_dir = TempDir::new().expect("failed to create store temp dir");
    let store = Arc::new(RocksStore::open(store_dir.path()).expect("failed to open RocksStore"));

    let project_service = Arc::new(ProjectService::new(Arc::clone(&store)));
    let task_service = Arc::new(TaskService::new(
        Arc::clone(&store),
        None,
    ));

    let project_dir = TempDir::new().expect("failed to create project temp dir");
    let project = project_service
        .create_project(aura_projects::CreateProjectInput {
            org_id: OrgId::new(),
            name: "test-project".into(),
            description: "integration test project".into(),
            linked_folder_path: project_dir.path().to_string_lossy().into_owned(),
            workspace_source: None,
            workspace_display_path: None,
            build_command: None,
            test_command: None,
        })
        .expect("failed to create project");

    let executor = ChatToolExecutor::new(store, None, project_service, task_service);

    TestHarness {
        executor,
        project_id: project.project_id,
        project_dir,
        _store_dir: store_dir,
    }
}

// ── File handler tests ──────────────────────────────────────────────────

#[tokio::test]
async fn read_file_returns_content() {
    let h = setup();
    let file_path = h.project_dir.path().join("hello.txt");
    std::fs::write(&file_path, "hello world").unwrap();

    let result = h
        .executor
        .execute(&h.project_id, "read_file", json!({ "path": "hello.txt" }))
        .await;

    assert!(!result.is_error, "unexpected error: {}", result.content);
    let v: serde_json::Value = serde_json::from_str(&result.content).unwrap();
    assert_eq!(v["content"].as_str().unwrap(), "hello world");
}

#[tokio::test]
async fn write_file_creates_new_file() {
    let h = setup();

    let result = h
        .executor
        .execute(
            &h.project_id,
            "write_file",
            json!({ "path": "new_file.txt", "content": "created by test" }),
        )
        .await;

    assert!(!result.is_error, "unexpected error: {}", result.content);

    let on_disk = std::fs::read_to_string(h.project_dir.path().join("new_file.txt")).unwrap();
    assert_eq!(on_disk, "created by test");
}

#[tokio::test]
async fn edit_file_replaces_text() {
    let h = setup();
    let file_path = h.project_dir.path().join("editable.txt");
    std::fs::write(&file_path, "aaa bbb ccc").unwrap();

    let result = h
        .executor
        .execute(
            &h.project_id,
            "edit_file",
            json!({
                "path": "editable.txt",
                "old_text": "bbb",
                "new_text": "ZZZ",
            }),
        )
        .await;

    assert!(!result.is_error, "unexpected error: {}", result.content);
    let on_disk = std::fs::read_to_string(&file_path).unwrap();
    assert_eq!(on_disk, "aaa ZZZ ccc");
}

#[tokio::test]
async fn read_file_rejects_path_escape() {
    let h = setup();

    let result = h
        .executor
        .execute(
            &h.project_id,
            "read_file",
            json!({ "path": "../../../etc/passwd" }),
        )
        .await;

    assert!(result.is_error, "expected path-escape error");
    assert!(
        result.content.to_lowercase().contains("path escape")
            || result.content.to_lowercase().contains("outside"),
        "error message should mention path escape: {}",
        result.content
    );
}

// ── Shell handler tests ─────────────────────────────────────────────────

#[tokio::test]
async fn run_command_captures_output() {
    let h = setup();

    let cmd = "echo hello";
    let result = h
        .executor
        .execute(
            &h.project_id,
            "run_command",
            json!({ "command": cmd }),
        )
        .await;

    assert!(!result.is_error, "unexpected error: {}", result.content);
    let v: serde_json::Value = serde_json::from_str(&result.content).unwrap();
    let stdout = v["stdout"].as_str().unwrap_or_default();
    assert!(
        stdout.contains("hello"),
        "stdout should contain 'hello', got: {stdout}"
    );
}

#[tokio::test]
async fn find_files_discovers_files() {
    let h = setup();

    let sub = h.project_dir.path().join("src");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("main.rs"), "fn main() {}").unwrap();

    let result = h
        .executor
        .execute(
            &h.project_id,
            "find_files",
            json!({ "pattern": "*.rs" }),
        )
        .await;

    assert!(!result.is_error, "unexpected error: {}", result.content);
    let v: serde_json::Value = serde_json::from_str(&result.content).unwrap();
    let files = v["files"].as_array().expect("files should be an array");
    let names: Vec<&str> = files.iter().filter_map(|f| f.as_str()).collect();
    assert!(
        names.iter().any(|n| n.contains("main.rs")),
        "should find main.rs, got: {names:?}"
    );
}
