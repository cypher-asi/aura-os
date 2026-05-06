#![cfg(unix)]

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mocks::{start_clobbering_mock_harness, start_recording_mock_harness};
use super::HARNESS_URL_ENV_LOCK;

// `dirs::home_dir()` on Windows ignores env vars and reads the real user
// profile from the OS, so these tests redirect `HOME` and only run on Unix to
// avoid polluting a developer's real ~/.aura/skills/.
#[tokio::test]
async fn create_skill_registers_with_harness_and_installs_for_agent() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({
        "name": "my-skill",
        "description": "A skill for tests",
        "body": "# Instructions",
        "agent_id": agent,
    });
    let req = json_request("POST", "/api/harness/skills", Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body = response_json(resp).await;
    assert_eq!(body["created"], true);
    assert_eq!(body["registered"], true);
    assert_eq!(body["installed_on_agent"], true);
    assert_eq!(body["name"], "my-skill");

    // The SKILL.md file should be written under the temp HOME.
    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("my-skill")
        .join("SKILL.md");
    assert!(
        skill_path.exists(),
        "expected SKILL.md at {}",
        skill_path.display()
    );
    let content = std::fs::read_to_string(&skill_path).unwrap();
    assert!(content.contains("description: \"A skill for tests\""));
    assert!(content.contains("# Instructions"));
    // The user-created marker must be present so list_my_skills can
    // distinguish this from a shop-installed skill that happens to share
    // the same on-disk layout.
    assert!(
        content.contains("source: \"user-created\""),
        "expected user-created source marker in frontmatter, got:\n{content}"
    );

    // Give the fire-and-forget POSTs a chance to hit the mock harness.
    for _ in 0..50 {
        if calls.lock().unwrap().len() >= 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    let captured = calls.lock().unwrap().clone();
    let register_call = captured
        .iter()
        .find(|(uri, _)| uri == "/api/skills")
        .expect("expected registration POST to /api/skills");
    let register_body: serde_json::Value =
        serde_json::from_str(&register_call.1).expect("register body is valid JSON");
    assert_eq!(register_body["name"], "my-skill");
    assert_eq!(register_body["description"], "A skill for tests");
    assert_eq!(register_body["user_invocable"], true);

    let install_call = captured
        .iter()
        .find(|(uri, _)| uri == format!("/api/agents/{agent}/skills"))
        .expect("expected install POST to /api/agents/<id>/skills");
    let install_body: serde_json::Value =
        serde_json::from_str(&install_call.1).expect("install body is valid JSON");
    assert_eq!(install_body["name"], "my-skill");
    assert!(install_body["approved_paths"].is_array());
    assert!(install_body["approved_commands"].is_array());
}

#[tokio::test]
async fn create_skill_without_agent_id_still_registers_catalog() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let payload = json!({
        "name": "solo-skill",
        "description": "No agent attached",
    });
    let req = json_request("POST", "/api/harness/skills", Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body = response_json(resp).await;
    assert_eq!(body["registered"], true);
    assert_eq!(body["installed_on_agent"], false);

    for _ in 0..50 {
        if !calls.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    let captured = calls.lock().unwrap().clone();
    assert!(
        captured.iter().any(|(uri, _)| uri == "/api/skills"),
        "expected at least one POST to /api/skills, got {:?}",
        captured
    );
    assert!(
        !captured
            .iter()
            .any(|(uri, _)| uri.starts_with("/api/agents/")),
        "did not expect any install POST when agent_id is omitted, got {:?}",
        captured
    );
}

/// Regression: reported in production — a skill created via the UI
/// ended up under "Available" (shop catalog) instead of "My Skills"
/// because the harness's own POST /api/skills handler writes its
/// OWN SKILL.md to `~/.aura/skills/<name>/`, clobbering the file we
/// wrote and stripping the `source: "user-created"` marker.
///
/// The fix is ordering: do the harness call first, then write our
/// marker-bearing file last. This test locks that ordering in.
#[tokio::test]
async fn create_skill_marker_survives_harness_overwrite() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let mock_url = start_clobbering_mock_harness(home_dir.path().to_path_buf()).await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let payload = json!({
        "name": "racey-skill",
        "description": "Under contention",
        "body": "# Body we want to keep",
    });
    let req = json_request("POST", "/api/harness/skills", Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("racey-skill")
        .join("SKILL.md");
    let content = std::fs::read_to_string(&skill_path).unwrap();

    assert!(
        content.contains("source: \"user-created\""),
        "user-created marker must survive the harness overwrite; got:\n{content}"
    );
    assert!(
        !content.contains("harness-body"),
        "harness body from clobbering write must have been overwritten; got:\n{content}"
    );
    assert!(
        content.contains("# Body we want to keep"),
        "our body content must be preserved; got:\n{content}"
    );
}
