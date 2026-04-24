mod common;

#[cfg(unix)]
use std::sync::Arc;
use std::sync::LazyLock;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::json;
use tokio::net::TcpListener;
use tower::ServiceExt;

use common::*;

static HARNESS_URL_ENV_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Start a lightweight mock harness that echoes back request info as JSON.
async fn start_mock_harness() -> (String, tokio::task::JoinHandle<()>) {
    let echo_handler = |req: Request<Body>| async move {
        let method = req.method().to_string();
        let uri = req.uri().to_string();
        let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        let body_str = String::from_utf8_lossy(&body_bytes).to_string();
        let resp = json!({
            "echoed_method": method,
            "echoed_uri": uri,
            "echoed_body": body_str,
        });
        axum::Json(resp).into_response()
    };

    let mock_app = Router::new()
        .route(
            "/api/agents/:agent_id/memory/facts",
            get(echo_handler).post(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory/facts/:fact_id",
            get(echo_handler).put(echo_handler).delete(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory/events",
            get(echo_handler).post(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory/events/:event_id",
            delete(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory/procedures",
            get(echo_handler).post(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory/procedures/by-skill/:skill_name",
            get(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory/procedures/:proc_id",
            get(echo_handler).put(echo_handler).delete(echo_handler),
        )
        .route(
            "/api/agents/:agent_id/memory",
            get(echo_handler).delete(echo_handler),
        )
        .route("/api/agents/:agent_id/memory/stats", get(echo_handler))
        .route(
            "/api/agents/:agent_id/memory/consolidate",
            post(echo_handler),
        )
        .route("/api/skills", get(echo_handler).post(echo_handler))
        .route("/api/skills/:name", get(echo_handler))
        .route("/api/skills/:name/activate", post(echo_handler))
        .route(
            "/api/agents/:agent_id/skills",
            get(echo_handler).post(echo_handler),
        )
        .route("/api/agents/:agent_id/skills/:name", delete(echo_handler));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let handle = tokio::spawn(async move {
        axum::serve(listener, mock_app).await.ok();
    });

    (url, handle)
}

#[tokio::test]
async fn proxy_forwards_get_facts() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"]
        .as_str()
        .unwrap()
        .contains(&format!("/api/agents/{agent}/memory/facts")));
}

#[tokio::test]
async fn proxy_forwards_post_with_body() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({"key": "lang", "value": "Rust", "confidence": 0.9});
    let req = json_request(
        "POST",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        Some(payload.clone()),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
    let echoed_body: serde_json::Value =
        serde_json::from_str(body["echoed_body"].as_str().unwrap()).unwrap();
    assert_eq!(echoed_body["key"], "lang");
}

#[tokio::test]
async fn proxy_forwards_delete() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "DELETE",
        &format!("/api/harness/agents/{agent}/memory/facts/f1"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "DELETE");
    assert!(body["echoed_uri"]
        .as_str()
        .unwrap()
        .contains(&format!("/api/agents/{agent}/memory/facts/f1")));
}

#[tokio::test]
async fn proxy_forwards_skills_list() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let req = json_request("GET", "/api/harness/skills", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"].as_str().unwrap().contains("/api/skills"));
}

#[tokio::test]
async fn proxy_forwards_skill_activate() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let payload = json!({"arguments": "production us-east-1"});
    let req = json_request("POST", "/api/harness/skills/deploy/activate", Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
    assert!(body["echoed_uri"]
        .as_str()
        .unwrap()
        .contains("/api/skills/deploy/activate"));
}

#[tokio::test]
async fn proxy_forwards_agent_skills_list() {
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("GET", &format!("/api/harness/agents/{agent}/skills"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"]
        .as_str()
        .unwrap()
        .contains(&format!("/api/agents/{agent}/skills")));
}

#[tokio::test]
async fn proxy_forwards_agent_skill_install() {
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({"name": "deploy", "source_url": null});
    let req = json_request(
        "POST",
        &format!("/api/harness/agents/{agent}/skills"),
        Some(payload),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
}

#[tokio::test]
async fn proxy_forwards_agent_skill_uninstall() {
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "DELETE",
        &format!("/api/harness/agents/{agent}/skills/deploy"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "DELETE");
    assert!(body["echoed_uri"]
        .as_str()
        .unwrap()
        .contains(&format!("/api/agents/{agent}/skills/deploy")));
}

#[tokio::test]
async fn proxy_forwards_procedures_by_skill() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", &mock_url);
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/procedures/by-skill/deploy"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    let uri = body["echoed_uri"].as_str().unwrap();
    assert!(uri.contains("/api/agents/"));
    assert!(uri.contains("/memory/procedures"));
    assert!(uri.contains("skill=deploy"));
}

/// Mock harness that, on `POST /api/skills`, writes a competing
/// SKILL.md to `~/.aura/skills/<name>/` in the style of the real
/// harness (no `source:` marker, `user-invocable` hyphenated,
/// includes a `name:` field). This is the shape that was landing
/// on disk in production and causing user-created skills to fall
/// out of "My Skills" into "Available".
///
/// The server's `create_skill` must run its own write *after* the
/// harness call so its marker-bearing frontmatter wins the race.
#[cfg(unix)]
async fn start_clobbering_mock_harness(home: std::path::PathBuf) -> String {
    #[derive(serde::Deserialize)]
    struct Body {
        name: String,
        description: Option<String>,
    }

    let home = std::sync::Arc::new(home);
    let home_post = home.clone();
    let skills_post = move |axum::Json(body): axum::Json<Body>| {
        let home = home_post.clone();
        async move {
            let dir = home.join(".aura").join("skills").join(&body.name);
            let _ = std::fs::create_dir_all(&dir);
            let desc = body.description.unwrap_or_default();
            // Frontmatter shape modelled on what the real harness
            // emits: `name:` field, `user-invocable:` hyphenated,
            // no `source:` marker.
            let contents = format!(
                "---\nname: \"{}\"\ndescription: \"{}\"\nuser-invocable: true\n---\nharness-body\n",
                body.name, desc
            );
            let _ = std::fs::write(dir.join("SKILL.md"), contents);
            axum::Json(json!({ "ok": true })).into_response()
        }
    };

    let agent_skills_post =
        |_req: Request<Body>| async move { axum::Json(json!({ "ok": true })).into_response() };

    let mock_app = Router::new()
        .route("/api/skills", post(skills_post))
        .route("/api/agents/:agent_id/skills", post(agent_skills_post));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    tokio::spawn(async move {
        axum::serve(listener, mock_app).await.ok();
    });

    url
}

/// Mock harness that records every POST it receives so tests can assert on them.
#[cfg(unix)]
async fn start_recording_mock_harness() -> (String, Arc<Mutex<Vec<(String, String)>>>) {
    let calls: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let calls_clone = calls.clone();

    let record = move |req: Request<Body>| {
        let calls = calls_clone.clone();
        async move {
            let uri = req.uri().to_string();
            let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
                .await
                .unwrap_or_default();
            let body_str = String::from_utf8_lossy(&body_bytes).to_string();
            calls.lock().unwrap().push((uri, body_str));
            axum::Json(json!({ "ok": true })).into_response()
        }
    };

    let mock_app = Router::new()
        .route("/api/skills", post(record.clone()))
        .route("/api/agents/:agent_id/skills", post(record.clone()));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    tokio::spawn(async move {
        axum::serve(listener, mock_app).await.ok();
    });

    (url, calls)
}

// `dirs::home_dir()` on Windows ignores env vars and reads the real user
// profile from the OS, so these tests redirect `HOME` and only run on Unix to
// avoid polluting a developer's real ~/.aura/skills/.
#[cfg(unix)]
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
        .join(".aura")
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

#[cfg(unix)]
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
#[cfg(unix)]
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
        .join(".aura")
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

#[cfg(unix)]
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
        .join(".aura")
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
        .join(".aura")
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

#[cfg(unix)]
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
        .join(".aura")
        .join("skills")
        .join("doomed-skill");
    assert!(skill_dir.join("SKILL.md").exists());

    // Drop a shop-style SKILL.md (no user-created marker). DELETE must
    // refuse to remove it — that would be a foot-gun.
    let shop_dir = home_dir
        .path()
        .join(".aura")
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

/// Mock harness that reports the current installation state for each
/// agent_id from a shared map. Used by the `delete_my_skill_*` cascade
/// tests below to exercise the server-side precondition that blocks a
/// delete while the skill is still installed anywhere.
#[cfg(unix)]
async fn start_installation_tracking_mock_harness(
    installs: Arc<Mutex<std::collections::HashMap<String, Vec<String>>>>,
) -> String {
    let installs_get = installs.clone();
    let agent_skills_get = move |axum::extract::Path(agent_id): axum::extract::Path<String>| {
        let installs = installs_get.clone();
        async move {
            let skills = installs
                .lock()
                .unwrap()
                .get(&agent_id)
                .cloned()
                .unwrap_or_default();
            let entries: Vec<serde_json::Value> = skills
                .into_iter()
                .map(|skill_name| {
                    json!({
                        "agent_id": agent_id,
                        "skill_name": skill_name,
                        "source_url": null,
                        "installed_at": "2025-01-01T00:00:00Z",
                        "version": null,
                        "approved_paths": [],
                        "approved_commands": [],
                    })
                })
                .collect();
            axum::Json(entries).into_response()
        }
    };

    let noop_post =
        |_req: Request<Body>| async move { axum::Json(json!({ "ok": true })).into_response() };
    let noop_delete =
        |_req: Request<Body>| async move { axum::Json(json!({ "ok": true })).into_response() };

    let mock_app = Router::new()
        .route("/api/skills", post(noop_post).delete(noop_delete))
        .route("/api/skills/:name", delete(noop_delete))
        .route(
            "/api/agents/:agent_id/skills",
            get(agent_skills_get).post(noop_post),
        )
        .route("/api/agents/:agent_id/skills/:name", delete(noop_delete));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    tokio::spawn(async move {
        axum::serve(listener, mock_app).await.ok();
    });

    url
}

/// Helper: persist a minimal `Agent` into the local shadow store used by
/// `state.agent_service.list_agents()`. The cascade precondition in
/// `delete_my_skill` enumerates agents from that store.
#[cfg(unix)]
fn persist_test_agent(state: &aura_os_server::AppState, name: &str) -> aura_os_core::AgentId {
    use aura_os_core::*;
    let agent_id = AgentId::new();
    let agent = Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: name.into(),
        role: "dev".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        auth_source: "local".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    state.agent_service.save_agent_shadow(&agent).unwrap();
    agent_id
}

/// Regression for a bug where deleting a user-authored skill in one agent
/// left every *other* agent's installation record pointing at a SKILL.md
/// file that no longer existed. Now the server refuses the delete with
/// 409 and tells the caller which agents are still holding on to it.
#[cfg(unix)]
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
        .join(".aura")
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
#[cfg(unix)]
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
        .join(".aura")
        .join("skills")
        .join("unblocked-skill")
        .join("SKILL.md");

    let req = json_request("DELETE", "/api/harness/skills/mine/unblocked-skill", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(!skill_path.exists());
}

/// Regression for the second half of the reported bug: the "Available"
/// list kept rendering a skill that had just been deleted, because the
/// harness catalog (in-memory) hadn't rescanned yet. The proxy now
/// drops entries whose on-disk SKILL.md is gone, making the filesystem
/// the source of truth for the catalog the UI sees.
#[cfg(unix)]
#[tokio::test]
async fn list_skills_filters_entries_missing_on_disk() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;

    let home_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("HOME", home_dir.path());
    }

    let skills_root = home_dir.path().join(".aura").join("skills");
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

#[tokio::test]
async fn delete_my_skill_rejects_invalid_name() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    // The invalid-name guard runs before any filesystem or harness access,
    // so a bogus LOCAL_HARNESS_URL is sufficient here and avoids pulling
    // in the unix-gated mock harness helper.
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", "http://127.0.0.1:1");
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    // Valid skill names are [a-z0-9-]+. Uppercase is invalid and makes a
    // clean URI segment that still reaches the handler, so the guard is
    // what produces the 400 (not the HTTP layer).
    let req = json_request("DELETE", "/api/harness/skills/mine/BadName", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn proxy_returns_502_on_connection_failure() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", "http://127.0.0.1:1");
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
}
