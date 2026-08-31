use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use aura_os_core::{
    Agent, AgentId, AgentInstanceId, AgentPermissions, JwtProvider, OrgId, ZeroAuthSession,
};
use aura_os_projects::CreateProjectInput;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use axum::extract::Query;
use axum::http::{HeaderMap, Request, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tower::ServiceExt;

mod common;

use common::{TEST_JWT, build_test_app_from_store, response_json};

const SECOND_JWT: &str = "second-user-token";

struct EnvReset(Vec<(&'static str, Option<String>)>);

impl EnvReset {
    fn capture(names: &[&'static str]) -> Self {
        Self(
            names
                .iter()
                .map(|name| (*name, std::env::var(name).ok()))
                .collect(),
        )
    }
}

impl Drop for EnvReset {
    fn drop(&mut self) {
        for (name, value) in &self.0 {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}

fn cached_session(jwt: &str, user_id: &str) -> aura_os_server::CachedSession {
    aura_os_server::CachedSession {
        session: ZeroAuthSession {
            user_id: user_id.into(),
            network_user_id: None,
            profile_id: None,
            display_name: user_id.into(),
            profile_image: String::new(),
            primary_zid: format!("zid-{user_id}"),
            zero_wallet: format!("wallet-{user_id}"),
            wallets: vec![],
            access_token: jwt.into(),
            is_zero_pro: true,
            is_access_granted: false,
            is_sys_admin: false,
            created_at: chrono::Utc::now(),
            validated_at: chrono::Utc::now(),
        },
        validated_at: std::time::Instant::now(),
        zero_pro_refresh_error: None,
    }
}

fn request_with_token(method: &str, uri: &str, jwt: &str) -> Request<axum::body::Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {jwt}"))
        .body(axum::body::Body::empty())
        .unwrap()
}

async fn start_harness() -> String {
    let resolve = |Query(query): Query<std::collections::HashMap<String, String>>| async move {
        let key = query.get("project_name").cloned().unwrap_or_default();
        Json(json!({ "path": format!("/hosted/workspaces/{key}") }))
    };
    let app = Router::new()
        .route("/workspace/resolve", get(resolve))
        .route(
            "/api/files",
            get(|| async {
                Json(json!({
                    "ok": true,
                    "entries": [
                        { "name": "index.html", "path": "index.html", "is_dir": false }
                    ]
                }))
            }),
        );
    let listener = TcpListener::bind("0.0.0.0:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://localhost.localdomain:{port}")
}

async fn start_token_scoped_storage(
    project_id: String,
    agent_instance_id: String,
    agent_id: String,
    first_lookup_started: Arc<Notify>,
    release_first_lookup: Arc<Notify>,
) -> String {
    let lookup_count = Arc::new(AtomicUsize::new(0));
    let handler = move |headers: HeaderMap| {
        let lookup_count = lookup_count.clone();
        let first_lookup_started = first_lookup_started.clone();
        let release_first_lookup = release_first_lookup.clone();
        let project_id = project_id.clone();
        let agent_instance_id = agent_instance_id.clone();
        let agent_id = agent_id.clone();
        async move {
            let bearer = headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok());
            if bearer != Some("Bearer test-token") {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": "project agent not found" })),
                )
                    .into_response();
            }
            if lookup_count.fetch_add(1, Ordering::SeqCst) == 0 {
                first_lookup_started.notify_one();
                release_first_lookup.notified().await;
            }
            Json(json!({
                "id": agent_instance_id,
                "projectId": project_id,
                "agentId": agent_id,
                "name": "Hosted builder",
                "status": "idle"
            }))
            .into_response()
        }
    };

    let app = Router::new().route("/api/project-agents/:project_agent_id", get(handler));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{address}")
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
async fn concurrent_web_requests_cannot_replace_the_hosted_files_callers_identity() {
    let _reset = EnvReset::capture(&[
        "LOCAL_HARNESS_URL",
        "LOCAL_HARNESS_AUTH_TOKEN",
        "NO_PROXY",
        "no_proxy",
    ]);
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", start_harness().await);
        std::env::set_var("LOCAL_HARNESS_AUTH_TOKEN", "hosted-file-secret");
        std::env::set_var("NO_PROXY", "127.0.0.1,localhost,localhost.localdomain");
        std::env::set_var("no_proxy", "127.0.0.1,localhost,localhost.localdomain");
    }

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    let project = aura_os_projects::ProjectService::new(store.clone())
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Concurrent hosted files".into(),
            description: String::new(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .unwrap();
    let agent_id = AgentId::new();
    let agent_instance_id = AgentInstanceId::new();
    let first_lookup_started = Arc::new(Notify::new());
    let release_first_lookup = Arc::new(Notify::new());
    let storage_url = start_token_scoped_storage(
        project.project_id.to_string(),
        agent_instance_id.to_string(),
        agent_id.to_string(),
        first_lookup_started.clone(),
        release_first_lookup.clone(),
    )
    .await;
    let (app, state) = build_test_app_from_store(
        store.clone(),
        store_dir.path().to_path_buf(),
        None,
        Some(Arc::new(StorageClient::with_base_url(&storage_url))),
        None,
        None,
    );
    state
        .agent_service
        .save_agent_shadow(&local_agent(agent_id))
        .unwrap();
    state
        .validation_cache
        .insert(SECOND_JWT.into(), cached_session(SECOND_JWT, "u2"));

    let files_uri = format!(
        "/api/projects/{}/agents/{}/workspace/files",
        project.project_id, agent_instance_id
    );
    let files_app = app.clone();
    let files_request = tokio::spawn(async move {
        files_app
            .oneshot(request_with_token("GET", &files_uri, TEST_JWT))
            .await
            .unwrap()
    });

    first_lookup_started.notified().await;
    let second_response = app
        .oneshot(request_with_token("GET", "/api/projects", SECOND_JWT))
        .await
        .unwrap();
    assert_eq!(second_response.status(), StatusCode::OK);
    assert_eq!(store.get_jwt().as_deref(), Some(SECOND_JWT));
    release_first_lookup.notify_one();

    let files_response = files_request.await.unwrap();
    let files_status = files_response.status();
    let files_body = response_json(files_response).await;
    assert_eq!(files_status, StatusCode::OK, "files response: {files_body}");
    assert_eq!(files_body["entries"][0]["name"], "index.html");
}
