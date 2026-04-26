#[cfg(unix)]
use std::sync::Arc;
#[cfg(unix)]
use std::sync::Mutex;

use axum::body::Body;
use axum::http::Request;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::json;
use tokio::net::TcpListener;

#[allow(dead_code)]
pub(crate) async fn start_mock_harness() -> (String, tokio::task::JoinHandle<()>) {
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

/// Mock harness that, on `POST /api/skills`, writes a competing
/// SKILL.md to `~/.aura/skills/<name>/` in the style of the real
/// harness (no `source:` marker, `user-invocable` hyphenated,
/// includes a `name:` field). This is the shape that was landing
/// on disk in production and causing user-created skills to fall
/// out of "My Skills" into "Available".
#[cfg(unix)]
#[allow(dead_code)]
pub(crate) async fn start_clobbering_mock_harness(home: std::path::PathBuf) -> String {
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
#[allow(dead_code)]
pub(crate) async fn start_recording_mock_harness() -> (String, Arc<Mutex<Vec<(String, String)>>>) {
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

/// Mock harness that reports the current installation state for each
/// agent_id from a shared map. Used by the `delete_my_skill_*` cascade
/// tests below to exercise the server-side precondition that blocks a
/// delete while the skill is still installed anywhere.
#[cfg(unix)]
#[allow(dead_code)]
pub(crate) async fn start_installation_tracking_mock_harness(
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
#[allow(dead_code)]
pub(crate) fn persist_test_agent(
    state: &aura_os_server::AppState,
    name: &str,
) -> aura_os_core::AgentId {
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
