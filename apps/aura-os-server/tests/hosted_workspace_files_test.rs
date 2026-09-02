use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use aura_os_core::{Agent, AgentId, AgentPermissions, OrgId};
use aura_os_projects::CreateProjectInput;
use aura_os_storage::CreateProjectAgentRequest;
use axum::extract::Query;
use axum::http::{header, Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, put};
use axum::{Json, Router};
use serde_json::json;
use tokio::net::TcpListener;
use tower::ServiceExt;

mod common;

use common::{build_test_app_with_storage, json_request, response_json, TEST_JWT};

fn environment_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

struct EnvReset {
    values: Vec<(&'static str, Option<String>)>,
}

impl EnvReset {
    fn capture(names: &[&'static str]) -> Self {
        Self {
            values: names
                .iter()
                .map(|name| (*name, std::env::var(name).ok()))
                .collect(),
        }
    }
}

impl Drop for EnvReset {
    fn drop(&mut self) {
        for (name, value) in &self.values {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}

type HarnessCall = (String, Option<String>, String);

async fn start_hosted_file_harness() -> (String, Arc<Mutex<Vec<HarnessCall>>>) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let calls_for_handler = calls.clone();
    let handler = move |request: Request<axum::body::Body>| {
        let calls = calls_for_handler.clone();
        async move {
            let uri = request.uri().to_string();
            let auth = request
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let body = axum::body::to_bytes(request.into_body(), 1024 * 1024)
                .await
                .expect("read harness request body");
            let body = String::from_utf8(body.to_vec()).expect("UTF-8 harness request body");
            calls
                .lock()
                .expect("calls lock")
                .push((uri.clone(), auth, body.clone()));

            if uri.starts_with("/api/files?") {
                return Json(json!({
                    "ok": true,
                    "entries": [
                        { "name": "index.html", "path": "index.html", "is_dir": false },
                        {
                            "name": "src",
                            "path": "src",
                            "is_dir": true,
                            "children": [
                                { "name": "app.ts", "path": "src/app.ts", "is_dir": false }
                            ]
                        }
                    ]
                }))
                .into_response();
            }
            if uri.starts_with("/api/read-file?") {
                return Json(json!({
                    "ok": true,
                    "path": "/hosted/workspace/src/app.ts",
                    "content": "export const source = 'hosted';",
                    "revision": "revision-1"
                }))
                .into_response();
            }
            if uri == "/api/write-file" {
                let request: serde_json::Value =
                    serde_json::from_str(&body).expect("valid write request JSON");
                return Json(json!({
                    "ok": true,
                    "path": request["path"],
                    "revision": "revision-2"
                }))
                .into_response();
            }
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "ok": false, "error": "not found" })),
            )
                .into_response()
        }
    };

    let resolve = |Query(query): Query<HashMap<String, String>>| async move {
        let project = query.get("project_name").cloned().unwrap_or_default();
        Json(json!({ "path": format!("/hosted/workspaces/{project}") }))
    };

    let app = Router::new()
        .route("/workspace/resolve", get(resolve))
        .route("/api/files", get(handler.clone()))
        .route("/api/read-file", get(handler.clone()))
        .route("/api/write-file", put(handler));
    let listener = TcpListener::bind("0.0.0.0:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    // localhost.localdomain resolves to loopback but is deliberately not
    // classified as AURA's in-process desktop Harness (which only recognises
    // localhost/127.0.0.1/::1). This lets the test exercise hosted routing
    // without reaching an external service.
    (format!("http://localhost.localdomain:{port}"), calls)
}

fn local_agent(agent_id: AgentId) -> Agent {
    let now = chrono::Utc::now();
    Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Hosted builder".into(),
        role: "developer".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: Vec::new(),
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        auth_source: "aura_managed".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        wallet_address: None,
        network_agent_id: None,
        profile_id: None,
        tags: Vec::new(),
        is_pinned: false,
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

#[tokio::test]
async fn hosted_files_are_project_scoped_and_forwarded_with_transport_auth() {
    let _lock = environment_lock().lock().await;
    let _reset = EnvReset::capture(&[
        "LOCAL_HARNESS_URL",
        "LOCAL_HARNESS_AUTH_TOKEN",
        "NO_PROXY",
        "no_proxy",
    ]);
    let (harness_url, calls) = start_hosted_file_harness().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", harness_url);
        std::env::set_var("LOCAL_HARNESS_AUTH_TOKEN", "hosted-file-secret");
        std::env::set_var("NO_PROXY", "127.0.0.1,localhost,localhost.localdomain");
        std::env::set_var("no_proxy", "127.0.0.1,localhost,localhost.localdomain");
    }

    let (app, state, storage, _dir) = build_test_app_with_storage().await;
    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Hosted files".into(),
            description: String::new(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");
    let other_project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Other project".into(),
            description: String::new(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create other project");
    let agent_id = AgentId::new();
    state
        .agent_service
        .save_agent_shadow(&local_agent(agent_id))
        .expect("save agent shadow");
    let instance = storage
        .create_project_agent(
            &project.project_id.to_string(),
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Hosted builder".into(),
                org_id: None,
                role: None,
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                instance_role: None,
                source: Some("ui".into()),
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    let list_uri = format!(
        "/api/projects/{}/agents/{}/workspace/files",
        project.project_id, instance.id
    );
    let list_response = app
        .clone()
        .oneshot(json_request("GET", &list_uri, None))
        .await
        .unwrap();
    let list_status = list_response.status();
    let list_body = response_json(list_response).await;
    assert_eq!(list_status, StatusCode::OK, "list response: {list_body}");
    assert_eq!(list_body["entries"][0]["name"], "index.html");
    assert_eq!(list_body["entries"][1]["children"][0]["path"], "src/app.ts");

    let read_uri = format!(
        "/api/projects/{}/agents/{}/workspace/read-file?path=src%2Fapp.ts",
        project.project_id, instance.id
    );
    let read_response = app
        .clone()
        .oneshot(json_request("GET", &read_uri, None))
        .await
        .unwrap();
    let read_status = read_response.status();
    let read_body = response_json(read_response).await;
    assert_eq!(read_status, StatusCode::OK, "read response: {read_body}");
    assert_eq!(read_body["content"], "export const source = 'hosted';");
    assert_eq!(read_body["revision"], "revision-1");

    let write_uri = format!(
        "/api/projects/{}/agents/{}/workspace/write-file",
        project.project_id, instance.id
    );
    let write_response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &write_uri,
            Some(json!({
                "path": "src/app.ts",
                "content_base64": "ZXhwb3J0IGNvbnN0IHNvdXJjZSA9ICdlZGl0ZWQnOw==",
                "expected_revision": "revision-1"
            })),
        ))
        .await
        .unwrap();
    let write_status = write_response.status();
    let write_body = response_json(write_response).await;
    assert_eq!(write_status, StatusCode::OK, "write response: {write_body}");
    assert_eq!(write_body["revision"], "revision-2");

    let cross_project_uri = format!(
        "/api/projects/{}/agents/{}/workspace/files",
        other_project.project_id, instance.id
    );
    let cross_project = app
        .clone()
        .oneshot(json_request("GET", &cross_project_uri, None))
        .await
        .unwrap();
    assert_eq!(cross_project.status(), StatusCode::NOT_FOUND);

    let traversal_uri = format!(
        "/api/projects/{}/agents/{}/workspace/read-file?path=..%2Fsecret.txt",
        project.project_id, instance.id
    );
    let traversal = app
        .oneshot(json_request("GET", &traversal_uri, None))
        .await
        .unwrap();
    assert_eq!(traversal.status(), StatusCode::BAD_REQUEST);

    let project_id = project.project_id.to_string();
    let calls = calls.lock().expect("calls lock");
    assert!(calls.iter().any(|(uri, auth, _body)| {
        uri.contains("/api/files?")
            && uri.contains(&project.project_id.to_string())
            && uri.contains("depth=20")
            && auth.as_deref() == Some("Bearer hosted-file-secret")
    }));
    assert!(calls.iter().any(|(uri, auth, _body)| {
        uri.contains("/api/read-file?")
            && uri.contains("src%2Fapp.ts")
            && auth.as_deref() == Some("Bearer hosted-file-secret")
    }));
    assert!(calls.iter().any(|(uri, auth, body)| {
        if uri != "/api/write-file" || auth.as_deref() != Some("Bearer hosted-file-secret") {
            return false;
        }
        let body: serde_json::Value = serde_json::from_str(body).expect("valid write body");
        body["path"]
            .as_str()
            .is_some_and(|path| path.ends_with("/src/app.ts") && path.contains(&project_id))
            && body["content_base64"] == "ZXhwb3J0IGNvbnN0IHNvdXJjZSA9ICdlZGl0ZWQnOw=="
            && body["expected_revision"] == "revision-1"
    }));
}
