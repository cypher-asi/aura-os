#![cfg(unix)]

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use serde_json::json;
use tokio::net::TcpListener;
use tower::ServiceExt;

use super::common::*;
use super::mocks::start_recording_mock_harness;
use super::HARNESS_URL_ENV_LOCK;

#[tokio::test]
async fn list_my_skills_returns_only_user_created_entries() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _calls) = start_recording_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    // Empty directory -> empty list, no panic.
    let (app, _, _db) = build_test_app_with_mocks().await;
    let req = json_request("GET", "/api/harness/skills/mine", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body, json!([]));

    // Author one via the real create_skill path.
    let create_payload = json!({
        "name": "authored-skill",
        "description": "Authored by user",
        "body": "# Body",
    });
    let req = json_request("POST", "/api/harness/skills", Some(create_payload));
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Simulate a shop-installed skill by writing a SKILL.md that lacks the
    // user-created marker. list_my_skills must NOT include it.
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

    // Also drop a malformed SKILL.md to confirm the scanner skips it gracefully.
    let bad_dir = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills")
        .join("broken-skill");
    std::fs::create_dir_all(&bad_dir).unwrap();
    std::fs::write(bad_dir.join("SKILL.md"), "no frontmatter here\n").unwrap();

    let req = json_request("GET", "/api/harness/skills/mine", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;

    let arr = body.as_array().expect("response should be a JSON array");
    assert_eq!(
        arr.len(),
        1,
        "expected only the user-authored skill, got {arr:?}"
    );
    assert_eq!(arr[0]["name"], "authored-skill");
    assert_eq!(arr[0]["description"], "Authored by user");
    assert_eq!(arr[0]["user_invocable"], true);
    assert_eq!(arr[0]["model_invocable"], false);
}

/// Regression for the second half of the reported bug: the "Available"
/// list kept rendering a skill that had just been deleted, because the
/// harness catalog (in-memory) hadn't rescanned yet. The proxy now
/// drops entries whose on-disk SKILL.md is gone, making the filesystem
/// the source of truth for the catalog the UI sees.
#[tokio::test]
async fn list_skills_filters_entries_missing_on_disk() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let skills_root = home_dir
        .path()
        .join(aura_os_core::Channel::current().skills_home_name())
        .join("skills");
    let kept_dir = skills_root.join("kept-skill");
    std::fs::create_dir_all(&kept_dir).unwrap();
    std::fs::write(
        kept_dir.join("SKILL.md"),
        "---\ndescription: \"still here\"\n---\n# body\n",
    )
    .unwrap();
    // `ghost-skill` is intentionally NOT present on disk — the harness
    // catalog may still return it if it hasn't rescanned.

    let catalog_handler = || async {
        axum::Json(json!([
            { "name": "kept-skill", "description": "still here", "source": "user" },
            { "name": "ghost-skill", "description": "already deleted", "source": "user" }
        ]))
        .into_response()
    };
    let mock_app = Router::new().route("/api/skills", get(catalog_handler));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mock_url = format!("http://{addr}");
    tokio::spawn(async move {
        axum::serve(listener, mock_app).await.ok();
    });
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;

    let req = json_request("GET", "/api/harness/skills", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let arr = body.as_array().expect("catalog should be an array");
    assert_eq!(
        arr.len(),
        1,
        "expected ghost-skill to be filtered, got {arr:?}"
    );
    assert_eq!(arr[0]["name"], "kept-skill");
}
