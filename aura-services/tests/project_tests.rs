use std::sync::Arc;

use aura_core::*;
use aura_services::*;
use aura_store::RocksStore;
use tempfile::TempDir;

fn setup() -> (Arc<RocksStore>, TempDir) {
    let dir = TempDir::new().expect("temp dir");
    let store = RocksStore::open(dir.path()).expect("open store");
    (Arc::new(store), dir)
}

fn valid_input(dir: &TempDir) -> CreateProjectInput {
    let folder = dir.path().to_str().unwrap().to_string();

    CreateProjectInput {
        org_id: OrgId::new(),
        name: "Test Project".into(),
        description: "A test project".into(),
        linked_folder_path: folder,
        github_integration_id: None,
        github_repo_full_name: None,
        build_command: None,
        test_command: None,
    }
}

// ---------------------------------------------------------------------------
// ProjectService
// ---------------------------------------------------------------------------

#[test]
fn create_project_returns_planning_status() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let input = valid_input(&dir);

    let project = svc.create_project(input).unwrap();
    assert_eq!(project.current_status, ProjectStatus::Planning);
    assert!(!project.name.is_empty());
    assert!(project.created_at <= project.updated_at);
}

#[test]
fn create_project_rejects_empty_name() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let mut input = valid_input(&dir);
    input.name = "  ".into();

    let err = svc.create_project(input).unwrap_err();
    assert!(matches!(err, ProjectError::InvalidInput(_)));
}

#[test]
fn create_project_rejects_nonexistent_folder() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let mut input = valid_input(&dir);
    input.linked_folder_path = "/nonexistent/folder/path".into();

    let err = svc.create_project(input).unwrap_err();
    assert!(matches!(err, ProjectError::InvalidInput(_)));
}

#[test]
fn get_project_round_trip() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let input = valid_input(&dir);

    let created = svc.create_project(input).unwrap();
    let fetched = svc.get_project(&created.project_id).unwrap();
    assert_eq!(created, fetched);
}

#[test]
fn get_missing_project_returns_not_found() {
    let (store, _dir) = setup();
    let svc = ProjectService::new(store);

    let err = svc.get_project(&ProjectId::new()).unwrap_err();
    assert!(matches!(err, ProjectError::NotFound(_)));
}

#[test]
fn list_projects_returns_all() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);

    svc.create_project(valid_input(&dir)).unwrap();
    svc.create_project(valid_input(&dir)).unwrap();

    let projects = svc.list_projects().unwrap();
    assert_eq!(projects.len(), 2);
}

#[test]
fn update_project_applies_partial_updates() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let project = svc.create_project(valid_input(&dir)).unwrap();

    let updated = svc
        .update_project(
            &project.project_id,
            UpdateProjectInput {
                name: Some("New Name".into()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(updated.name, "New Name");
    assert_eq!(updated.description, project.description);
    assert!(updated.updated_at > project.updated_at);
}

#[test]
fn update_project_rejects_empty_name() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let project = svc.create_project(valid_input(&dir)).unwrap();

    let err = svc
        .update_project(
            &project.project_id,
            UpdateProjectInput {
                name: Some("".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(matches!(err, ProjectError::InvalidInput(_)));
}

#[test]
fn archive_project_sets_archived_status() {
    let (store, dir) = setup();
    let svc = ProjectService::new(store);
    let project = svc.create_project(valid_input(&dir)).unwrap();

    let archived = svc.archive_project(&project.project_id).unwrap();
    assert_eq!(archived.current_status, ProjectStatus::Archived);
}

// ---------------------------------------------------------------------------
// Spec generation response parser
// ---------------------------------------------------------------------------

#[test]
fn parse_direct_json() {
    let json = concat!(
        r#"[{"title": "Core Types", "purpose": "Define types", "markdown": "Types details"},"#,
        r#"{"title": "Store Layer", "purpose": "Persistence", "markdown": "Store details"}]"#,
    );

    let result = SpecGenerationService::parse_claude_response_for_test(json);
    assert!(result.is_ok());
    let specs = result.unwrap();
    assert_eq!(specs.len(), 2);
    assert_eq!(specs[0].title, "Core Types");
}

#[test]
fn parse_fenced_json() {
    let response = "Here are the specs:\n\n```json\n[\n{\"title\": \"Auth\", \"purpose\": \"Authentication\", \"markdown\": \"Login flow\"}\n]\n```\n";

    let result = SpecGenerationService::parse_claude_response_for_test(response);
    assert!(result.is_ok());
    let specs = result.unwrap();
    assert_eq!(specs.len(), 1);
}

#[test]
fn parse_empty_array_fails() {
    let result = SpecGenerationService::parse_claude_response_for_test("[]");
    assert!(result.is_err());
}

#[test]
fn parse_invalid_json_fails() {
    let result = SpecGenerationService::parse_claude_response_for_test("not json at all");
    assert!(result.is_err());
}

#[test]
fn parse_empty_title_fails() {
    let json = r#"[{"title": "", "purpose": "test", "markdown": "content"}]"#;
    let result = SpecGenerationService::parse_claude_response_for_test(json);
    assert!(result.is_err());
}

#[test]
fn parse_empty_markdown_fails() {
    let json = r#"[{"title": "Test", "purpose": "test", "markdown": ""}]"#;
    let result = SpecGenerationService::parse_claude_response_for_test(json);
    assert!(result.is_err());
}
