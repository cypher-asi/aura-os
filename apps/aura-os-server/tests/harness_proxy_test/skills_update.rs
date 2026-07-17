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
            "agent_target": {
                "agent_id": "00000000-0000-0000-0000-000000000002",
                "name": "Security Reviewer",
            },
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
    // The harness parser requires a `name:` field; an edit must keep it so
    // the rewritten skill stays loadable in the registry.
    assert!(
        content.contains("name: \"edit-me\""),
        "expected name field in rewritten frontmatter, got:\n{content}"
    );
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
        content.contains("agent_target_id: \"00000000-0000-0000-0000-000000000002\""),
        "expected collaborator id to be persisted, got:\n{content}"
    );
    assert!(
        content.contains("agent_target_name: \"Security Reviewer\""),
        "expected collaborator name to be persisted, got:\n{content}"
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
    assert_eq!(
        reregister_body["agent_target"]["agent_id"],
        "00000000-0000-0000-0000-000000000002"
    );
    assert_eq!(reregister_body["agent_target"]["name"], "Security Reviewer");
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

/// End-to-end check of the startup recovery: the real public entry point
/// (`repair_user_skills_on_startup`) resolves the channel-aware skills root
/// from the home dir, backfills `name:` into a pre-fix user-created skill so
/// the harness can load it again, and leaves a shop skill (no marker)
/// untouched — proving the migration is safe and exercises the real flow,
/// not just the parameterised unit logic.
#[tokio::test]
async fn repair_user_skills_on_startup_backfills_name_and_spares_shop_skills() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let skills_root = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills");

    // A user-created skill written the old way — no `name:` field.
    let nameless = skills_root.join("recover-me");
    std::fs::create_dir_all(&nameless).unwrap();
    std::fs::write(
        nameless.join("SKILL.md"),
        "---\ndescription: \"x\"\nuser_invocable: true\nsource: \"user-created\"\n---\nbody\n",
    )
    .unwrap();

    // A shop-installed skill (no marker) must never be rewritten.
    let shop = skills_root.join("shop-skill");
    std::fs::create_dir_all(&shop).unwrap();
    let shop_original = "---\ndescription: \"from shop\"\n---\nbody\n";
    std::fs::write(shop.join("SKILL.md"), shop_original).unwrap();

    aura_os_server::repair_user_skills_on_startup();

    let recovered = std::fs::read_to_string(nameless.join("SKILL.md")).unwrap();
    assert!(
        recovered.starts_with("---\nname: \"recover-me\"\n"),
        "user-created skill should be backfilled with its name, got:\n{recovered}"
    );
    assert_eq!(
        std::fs::read_to_string(shop.join("SKILL.md")).unwrap(),
        shop_original,
        "shop skill (no user-created marker) must not be modified"
    );
}

/// `get_my_skill` must return EVERY field the edit form needs, read from the
/// marker file — including `user_invocable` / `model_invocable` /
/// `allowed_tools`, which the harness-backed `get_skill` silently drops. This
/// is what makes the edit round-trip faithful (no settings reset on save).
#[tokio::test]
async fn get_my_skill_returns_all_fields_for_the_edit_form() {
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

    // Create with the full set of fields and NON-default invocable flags.
    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "rt",
            "description": "round trip",
            "body": "# body",
            "allowed_tools": ["read_file", "write_file"],
            "model": "claude-opus-4-8",
            "context": "ctx",
            "user_invocable": false,
            "model_invocable": true,
            "agent_target": {
                "agent_id": "00000000-0000-0000-0000-000000000002",
                "name": "Reviewer",
            },
        })),
    );
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::CREATED
    );

    let req = json_request("GET", "/api/harness/skills/mine/rt", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "rt");
    assert_eq!(body["description"], "round trip");
    assert!(body["body"].as_str().unwrap().contains("# body"));
    // The three the harness-backed getSkill would have lost:
    assert_eq!(body["user_invocable"], false);
    assert_eq!(body["model_invocable"], true);
    assert_eq!(body["allowed_tools"], json!(["read_file", "write_file"]));
    // And the two it preserved:
    assert_eq!(body["model"], "claude-opus-4-8");
    assert_eq!(body["context"], "ctx");
    assert_eq!(
        body["agent_target"],
        json!({
            "agent_id": "00000000-0000-0000-0000-000000000002",
            "name": "Reviewer",
        })
    );
}

/// Fetching a skill that doesn't exist on disk is a 404.
#[tokio::test]
async fn get_my_skill_missing_returns_404() {
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

    let req = json_request("GET", "/api/harness/skills/mine/no-such-skill", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// Fetching a skill that lacks the `user-created` marker (a shop-installed
/// one) is refused with 403 — never expose/edit a non-user skill.
#[tokio::test]
async fn get_my_skill_refuses_non_user_created() {
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
    std::fs::write(
        shop_dir.join("SKILL.md"),
        "---\nname: \"shop-skill\"\ndescription: \"from shop\"\n---\n# body\n",
    )
    .unwrap();

    let req = json_request("GET", "/api/harness/skills/mine/shop-skill", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

/// Full edit cycle in one flow: create -> open for edit (get_my_skill) ->
/// save while changing ONLY the description (sending the other fields back
/// exactly as the modal does after pre-fill) -> re-open. Everything except
/// the description must survive — this is the end-to-end proof that editing
/// no longer silently resets user_invocable / model_invocable / allowed_tools.
#[tokio::test]
async fn editing_preserves_all_settings_full_round_trip() {
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

    // Create with non-default flags + tools/model/context.
    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "cycle",
            "description": "original",
            "body": "# body",
            "allowed_tools": ["read_file", "write_file"],
            "model": "claude-opus-4-8",
            "context": "ctx",
            "user_invocable": false,
            "model_invocable": true,
            "agent_target": {
                "agent_id": "00000000-0000-0000-0000-000000000002",
                "name": "Reviewer",
            },
        })),
    );
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::CREATED
    );

    // Open for edit — the modal pre-fills from this.
    let req = json_request("GET", "/api/harness/skills/mine/cycle", None);
    let pre = response_json(app.clone().oneshot(req).await.unwrap()).await;
    assert_eq!(pre["user_invocable"], false);
    assert_eq!(pre["model_invocable"], true);
    assert_eq!(pre["allowed_tools"], json!(["read_file", "write_file"]));

    // Save: change only the description, sending the rest back unchanged
    // (exactly what the modal does with its pre-filled + preserved values).
    let req = json_request(
        "PUT",
        "/api/harness/skills/mine/cycle",
        Some(json!({
            "description": "edited",
            "body": "# body",
            "user_invocable": false,
            "model_invocable": true,
            "allowed_tools": ["read_file", "write_file"],
            "model": "claude-opus-4-8",
            "context": "ctx",
            "agent_target": {
                "agent_id": "00000000-0000-0000-0000-000000000002",
                "name": "Reviewer",
            },
        })),
    );
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );

    // Re-open: description changed, everything else preserved.
    let req = json_request("GET", "/api/harness/skills/mine/cycle", None);
    let post = response_json(app.oneshot(req).await.unwrap()).await;
    assert_eq!(post["description"], "edited");
    assert_eq!(
        post["user_invocable"], false,
        "user_invocable must survive an edit"
    );
    assert_eq!(
        post["model_invocable"], true,
        "model_invocable must survive an edit"
    );
    assert_eq!(
        post["allowed_tools"],
        json!(["read_file", "write_file"]),
        "allowed_tools must survive an edit"
    );
    assert_eq!(post["model"], "claude-opus-4-8");
    assert_eq!(post["context"], "ctx");
    assert_eq!(
        post["agent_target"],
        json!({
            "agent_id": "00000000-0000-0000-0000-000000000002",
            "name": "Reviewer",
        }),
        "agent collaborator binding must survive an edit"
    );
}

#[tokio::test]
async fn update_my_skill_rejects_invalid_agent_target_without_touching_file() {
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

    let create = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "safe-edit",
            "description": "Original",
            "body": "# Original",
        })),
    );
    assert_eq!(
        app.clone().oneshot(create).await.unwrap().status(),
        StatusCode::CREATED
    );
    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("safe-edit")
        .join("SKILL.md");
    let before = std::fs::read_to_string(&skill_path).unwrap();

    let update = json_request(
        "PUT",
        "/api/harness/skills/mine/safe-edit",
        Some(json!({
            "description": "Changed",
            "body": "# Changed",
            "agent_target": { "agent_id": "bad-id", "name": "Reviewer" },
        })),
    );
    assert_eq!(
        app.oneshot(update).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(std::fs::read_to_string(&skill_path).unwrap(), before);
}
