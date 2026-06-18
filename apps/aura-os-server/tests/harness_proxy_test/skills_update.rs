#![cfg(unix)]

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mocks::{start_failing_skills_mock_harness, start_recording_mock_harness};
use super::HARNESS_URL_ENV_LOCK;

// `dirs::home_dir()` on Windows ignores env vars and reads the real user
// profile from the OS, so these tests redirect `HOME` and only run on Unix to
// avoid polluting a developer's real ~/.aura/skills/.

/// Happy path: editing a user-authored skill rewrites SKILL.md (frontmatter
/// + body), preserves the `user-created` marker so it stays under "My
/// Skills", and re-registers the new content with the harness catalog.
#[tokio::test]
async fn update_my_skill_rewrites_file_and_reregisters() {
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

    // Author a skill via the real create path so it carries the marker.
    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "edit-me",
            "description": "Original description",
            "body": "# Original body",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Now edit it.
    let req = json_request(
        "PUT",
        "/api/harness/skills/mine/edit-me",
        Some(json!({
            "description": "Updated description",
            "body": "# Updated body",
            "user_invocable": false,
            "model_invocable": true,
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "edit-me");
    assert_eq!(body["updated"], true);

    // SKILL.md must reflect the new content and KEEP the user-created marker.
    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("edit-me")
        .join("SKILL.md");
    let content = std::fs::read_to_string(&skill_path).unwrap();
    assert!(
        content.contains("description: \"Updated description\""),
        "expected updated description, got:\n{content}"
    );
    assert!(
        content.contains("# Updated body"),
        "expected updated body, got:\n{content}"
    );
    assert!(
        !content.contains("# Original body"),
        "old body must be gone, got:\n{content}"
    );
    assert!(
        content.contains("user_invocable: false"),
        "expected user_invocable flag to be persisted, got:\n{content}"
    );
    assert!(
        content.contains("model_invocable: true"),
        "expected model_invocable flag to be persisted, got:\n{content}"
    );
    assert!(
        content.contains("source: \"user-created\""),
        "user-created marker must survive an edit, got:\n{content}"
    );

    // And list_my_skills still reports it with the updated metadata.
    let req = json_request("GET", "/api/harness/skills/mine", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let arr = body.as_array().expect("response should be a JSON array");
    let entry = arr
        .iter()
        .find(|e| e["name"] == "edit-me")
        .expect("edited skill should still be listed");
    assert_eq!(entry["description"], "Updated description");
    assert_eq!(entry["user_invocable"], false);
    assert_eq!(entry["model_invocable"], true);

    // The edit must have re-registered the new content with the harness.
    for _ in 0..50 {
        if calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(uri, b)| uri == "/api/skills" && b.contains("Updated description"))
            .count()
            >= 1
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let captured = calls.lock().unwrap().clone();
    let reregister = captured
        .iter()
        .find(|(uri, b)| uri == "/api/skills" && b.contains("Updated description"))
        .expect("expected a re-register POST to /api/skills with updated content");
    let reregister_body: serde_json::Value =
        serde_json::from_str(&reregister.1).expect("re-register body is valid JSON");
    assert_eq!(reregister_body["name"], "edit-me");
    assert_eq!(reregister_body["description"], "Updated description");
    assert_eq!(reregister_body["body"], "# Updated body");
}

/// If the harness rejects the re-register POST, the edit must fail loud
/// (502) and leave the on-disk SKILL.md untouched — never report success
/// for a change that didn't go live. That harness POST is the only thing
/// that reloads the live skill registry, so a silent failure would serve
/// stale content behind a 200.
#[tokio::test]
async fn update_my_skill_harness_failure_returns_502_and_leaves_file() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let mock_url = start_failing_skills_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }
    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }
    let (app, _, _db) = build_test_app_with_mocks().await;

    // Create lands its marker file even though the harness POST is best-effort
    // and fails here, so we have a real user-authored skill to try to edit.
    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "edit-me",
            "description": "Original description",
            "body": "# Original body",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("edit-me")
        .join("SKILL.md");
    let before = std::fs::read_to_string(&skill_path).unwrap();

    // The edit's re-register POST hits the failing harness → 502.
    let req = json_request(
        "PUT",
        "/api/harness/skills/mine/edit-me",
        Some(json!({
            "description": "Updated description",
            "body": "# Updated body",
        })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    // The file must be exactly as it was — no partial "disk new / registry old".
    let after = std::fs::read_to_string(&skill_path).unwrap();
    assert_eq!(
        before, after,
        "a failed re-register must not rewrite the skill file"
    );
}

/// Editing a skill that does not exist on disk is a 404.
#[tokio::test]
async fn update_my_skill_missing_returns_404() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }
    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }
    let (app, _, _db) = build_test_app_with_mocks().await;

    let req = json_request(
        "PUT",
        "/api/harness/skills/mine/no-such-skill",
        Some(json!({ "description": "x" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// Editing a skill that lacks the `user-created` marker (e.g. a
/// shop-installed one sharing the on-disk layout) is refused with 403 and
/// must not touch the file.
#[tokio::test]
async fn update_my_skill_refuses_non_user_created() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }
    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }
    let (app, _, _db) = build_test_app_with_mocks().await;

    let shop_dir = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("shop-skill");
    std::fs::create_dir_all(&shop_dir).unwrap();
    let original = "---\ndescription: \"From shop\"\nuser_invocable: true\n---\n# Shop body\n";
    std::fs::write(shop_dir.join("SKILL.md"), original).unwrap();

    let req = json_request(
        "PUT",
        "/api/harness/skills/mine/shop-skill",
        Some(json!({ "description": "hijacked", "body": "# pwned" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // The file must be untouched.
    let content = std::fs::read_to_string(shop_dir.join("SKILL.md")).unwrap();
    assert_eq!(content, original, "shop skill file must NOT be modified");
}

/// Invalid skill name in the path is a 400 (mirrors create/delete name
/// validation).
#[tokio::test]
async fn update_my_skill_invalid_name_returns_400() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }
    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }
    let (app, _, _db) = build_test_app_with_mocks().await;

    let req = json_request(
        "PUT",
        "/api/harness/skills/mine/Bad_Name",
        Some(json!({ "description": "x" })),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
