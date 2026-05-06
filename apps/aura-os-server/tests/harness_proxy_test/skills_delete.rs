#![cfg(unix)]

use std::sync::Arc;
use std::sync::Mutex;

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mocks::{
    persist_test_agent, start_installation_tracking_mock_harness, start_recording_mock_harness,
};
use super::HARNESS_URL_ENV_LOCK;

#[tokio::test]
async fn delete_my_skill_removes_user_created_and_refuses_shop_skill() {
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

    // Author a user skill via the real create path so it carries the
    // `source: "user-created"` marker.
    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "doomed-skill",
            "description": "Will be deleted",
            "body": "# Body",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let skill_dir = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("doomed-skill");
    assert!(skill_dir.join("SKILL.md").exists());

    // Drop a shop-style SKILL.md (no user-created marker). DELETE must
    // refuse to remove it — that would be a foot-gun.
    let shop_dir = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("shop-skill");
    std::fs::create_dir_all(&shop_dir).unwrap();
    std::fs::write(
        shop_dir.join("SKILL.md"),
        "---\ndescription: \"From shop\"\nuser_invocable: true\n---\n# Shop body\n",
    )
    .unwrap();

    let req = json_request("DELETE", "/api/harness/skills/mine/shop-skill", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    assert!(
        shop_dir.join("SKILL.md").exists(),
        "shop skill file must NOT be deleted by the mine/ endpoint",
    );

    // Missing skill -> 404.
    let req = json_request("DELETE", "/api/harness/skills/mine/no-such-skill", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Happy path: deletes the user-authored skill directory and reports success.
    let req = json_request("DELETE", "/api/harness/skills/mine/doomed-skill", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "doomed-skill");
    assert_eq!(body["deleted"], true);
    assert!(!skill_dir.exists(), "skill dir must be removed from disk");

    // And list_my_skills no longer reports it.
    let req = json_request("GET", "/api/harness/skills/mine", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let arr = body.as_array().expect("response should be a JSON array");
    assert!(
        arr.iter().all(|e| e["name"] != "doomed-skill"),
        "deleted skill should not appear in list_my_skills: {arr:?}",
    );
}

/// Regression for a bug where deleting a user-authored skill in one agent
/// left every *other* agent's installation record pointing at a SKILL.md
/// file that no longer existed. Now the server refuses the delete with
/// 409 and tells the caller which agents are still holding on to it.
#[tokio::test]
async fn delete_my_skill_blocked_when_installed_on_any_agent() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;

    let installs: Arc<Mutex<std::collections::HashMap<String, Vec<String>>>> =
        Arc::new(Mutex::new(std::collections::HashMap::new()));
    let mock_url = start_installation_tracking_mock_harness(installs.clone()).await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let (app, state, _db) = build_test_app_with_mocks().await;

    // Two agents exist locally; only CEO has the skill installed.
    let ceo_id = persist_test_agent(&state, "CEO Agent");
    let _other_id = persist_test_agent(&state, "Other Agent");

    // Author a skill on disk with the user-created marker.
    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "cascade-skill",
            "description": "Installed elsewhere",
            "body": "# Body",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    installs
        .lock()
        .unwrap()
        .insert(ceo_id.to_string(), vec!["cascade-skill".to_string()]);

    // Delete must be blocked with 409 and name the blocker.
    let req = json_request("DELETE", "/api/harness/skills/mine/cascade-skill", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = response_json(resp).await;
    assert_eq!(body["error"], "installed_on_agents");
    let blockers = body["agents"]
        .as_array()
        .expect("agents should be an array");
    assert_eq!(blockers.len(), 1);
    assert_eq!(blockers[0]["agent_id"], ceo_id.to_string());
    assert_eq!(blockers[0]["name"], "CEO Agent");

    // The on-disk SKILL.md must still be there since delete was rejected.
    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("cascade-skill")
        .join("SKILL.md");
    assert!(
        skill_path.exists(),
        "blocked delete must NOT remove the skill file"
    );

    // Once the blocking agent uninstalls, the delete must succeed.
    installs.lock().unwrap().insert(ceo_id.to_string(), vec![]);

    let req = json_request("DELETE", "/api/harness/skills/mine/cascade-skill", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(
        !skill_path.exists(),
        "happy-path delete must remove the skill file"
    );
}

/// Sanity check: with no local agents having the skill installed, the
/// existing happy path still works (and the enumeration is tolerant of
/// a harness that 404s / is offline for per-agent fetches).
#[tokio::test]
async fn delete_my_skill_proceeds_when_not_installed_anywhere() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;

    let installs: Arc<Mutex<std::collections::HashMap<String, Vec<String>>>> =
        Arc::new(Mutex::new(std::collections::HashMap::new()));
    let mock_url = start_installation_tracking_mock_harness(installs.clone()).await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let (app, state, _db) = build_test_app_with_mocks().await;
    let _a = persist_test_agent(&state, "Solo Agent");

    let req = json_request(
        "POST",
        "/api/harness/skills",
        Some(json!({
            "name": "unblocked-skill",
            "description": "Nobody has it",
            "body": "# Body",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let skill_path = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("unblocked-skill")
        .join("SKILL.md");

    let req = json_request("DELETE", "/api/harness/skills/mine/unblocked-skill", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!skill_path.exists());
}
