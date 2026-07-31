#![cfg(unix)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::persist_test_agent;
use super::HARNESS_URL_ENV_LOCK;

async fn start_skill_storage(skill: Value) -> String {
    let sync_skill = skill.clone();
    let assigned_skill = skill;
    let app = Router::new()
        .route(
            "/api/skills/sync",
            get(move || {
                let skill = sync_skill.clone();
                async move { Json(vec![skill]) }
            }),
        )
        .route(
            "/api/agents/:agent_id/skills",
            get(move || {
                let skill = assigned_skill.clone();
                async move { Json(vec![skill]) }
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{address}")
}

async fn start_stateful_skill_harness(
    accept_definition: bool,
) -> (String, Arc<Mutex<Vec<String>>>) {
    let installations = Arc::new(Mutex::new(HashMap::<String, Vec<String>>::new()));
    let installation_posts = Arc::new(Mutex::new(Vec::<String>::new()));

    let get_state = installations.clone();
    let get_installs = move |Path(agent_id): Path<String>| {
        let state = get_state.clone();
        async move {
            let names = state
                .lock()
                .unwrap()
                .get(&agent_id)
                .cloned()
                .unwrap_or_default();
            let rows = names
                .into_iter()
                .map(|skill_name| {
                    json!({
                        "agent_id": agent_id,
                        "skill_name": skill_name,
                        "source_url": null,
                        "installed_at": "2026-01-01T00:00:00Z",
                        "version": null,
                        "approved_paths": [],
                        "approved_commands": [],
                    })
                })
                .collect::<Vec<_>>();
            Json(rows)
        }
    };

    let post_state = installations.clone();
    let post_calls = installation_posts.clone();
    let post_install = move |Path(agent_id): Path<String>, Json(body): Json<Value>| {
        let state = post_state.clone();
        let calls = post_calls.clone();
        async move {
            let name = body["name"].as_str().unwrap_or_default().to_string();
            calls.lock().unwrap().push(name.clone());
            state
                .lock()
                .unwrap()
                .entry(agent_id.clone())
                .or_default()
                .push(name.clone());
            (
                StatusCode::CREATED,
                Json(json!({ "agent_id": agent_id, "skill_name": name })),
            )
        }
    };

    let definition_status = move || async move {
        if accept_definition {
            StatusCode::CREATED
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    let app = Router::new()
        .route("/api/skills", post(definition_status))
        .route(
            "/api/agents/:agent_id/skills",
            get(get_installs).post(post_install),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    (format!("http://{address}"), installation_posts)
}

async fn build_sync_test_app(
    accept_definition: bool,
) -> (
    Router,
    aura_os_core::AgentId,
    Arc<Mutex<Vec<String>>>,
    tempfile::TempDir,
    tempfile::TempDir,
) {
    let skill = json!({
        "id": "11111111-1111-4111-8111-111111111111",
        "orgId": null,
        "createdBy": "22222222-2222-4222-8222-222222222222",
        "name": "portable-check",
        "description": "Portable check",
        "body": "# Check",
        "allowedTools": [],
        "model": null,
        "context": null,
        "userInvocable": true,
        "modelInvocable": false,
        "agentTarget": null,
        "revision": 1,
        "contentHash": "hash-1",
        "createdAt": null,
        "updatedAt": null,
        "deletedAt": null,
    });
    let storage_url = start_skill_storage(skill).await;
    let (harness_url, installation_posts) = start_stateful_skill_harness(accept_definition).await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", harness_url) };

    let home = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var("HOME", home.path()) };
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let storage = Arc::new(StorageClient::with_base_url(&storage_url));
    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        Some(storage),
        None,
        None,
    );
    let agent = persist_test_agent(&state, "Skill sync target");

    (app, agent, installation_posts, home, store_dir)
}

#[tokio::test]
async fn canonical_assignment_is_installed_before_the_list_response() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (app, agent, installation_posts, _home, _store_dir) = build_sync_test_app(true).await;

    let response = app
        .oneshot(json_request(
            "GET",
            &format!("/api/harness/agents/{agent}/skills"),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body.as_array().map(Vec::len), Some(1));
    assert_eq!(body[0]["skill_name"], "portable-check");
    assert_eq!(
        installation_posts.lock().unwrap().as_slice(),
        ["portable-check"]
    );
}

#[tokio::test]
async fn rejected_definition_never_creates_a_ghost_assignment() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    let (app, agent, installation_posts, _home, _store_dir) = build_sync_test_app(false).await;

    let response = app
        .oneshot(json_request(
            "GET",
            &format!("/api/harness/agents/{agent}/skills"),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await, json!([]));
    assert!(installation_posts.lock().unwrap().is_empty());
}
