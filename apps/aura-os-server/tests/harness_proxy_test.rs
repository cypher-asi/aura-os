mod common;

use std::sync::{LazyLock, Mutex};
#[cfg(unix)]
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::json;
use tokio::net::TcpListener;
use tower::ServiceExt;

use common::*;

static HARNESS_URL_ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
        .route(
            "/api/agents/:agent_id/skills",
            post(record.clone()),
        );

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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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

#[cfg(unix)]
#[tokio::test]
async fn list_my_skills_returns_only_user_created_entries() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let shop_dir = home_dir.path().join(".aura").join("skills").join("shop-skill");
    std::fs::create_dir_all(&shop_dir).unwrap();
    std::fs::write(
        shop_dir.join("SKILL.md"),
        "---\ndescription: \"From shop\"\nuser_invocable: true\n---\n# Shop body\n",
    )
    .unwrap();

    // Also drop a malformed SKILL.md to confirm the scanner skips it gracefully.
    let bad_dir = home_dir.path().join(".aura").join("skills").join("broken-skill");
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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

    let skill_dir = home_dir.path().join(".aura").join("skills").join("doomed-skill");
    assert!(skill_dir.join("SKILL.md").exists());

    // Drop a shop-style SKILL.md (no user-created marker). DELETE must
    // refuse to remove it — that would be a foot-gun.
    let shop_dir = home_dir.path().join(".aura").join("skills").join("shop-skill");
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

#[tokio::test]
async fn delete_my_skill_rejects_invalid_name() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
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
