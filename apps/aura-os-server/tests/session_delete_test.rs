//! Integration test for DELETE /api/projects/:p/agents/:a/sessions/:s.
//!
//! Uses the in-memory mock storage server so we exercise the full proxy:
//! aura-os-server handler → StorageClient::delete_session → mock storage
//! DELETE /api/sessions/:id.

mod common;

use std::sync::Arc;

use axum::body::Body;
use axum::extract::Path;
use axum::http::{Request, StatusCode};
use axum::routing::delete;
use axum::Json;
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower::ServiceExt;

use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionRequest, StorageClient, UpdateSessionRequest,
    SESSION_STATUS_DELETED,
};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn delete_session_removes_session_from_storage() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    // Seed: project agent + session in the mock storage.
    let project_id = uuid::Uuid::new_v4().to_string();
    let agent_id = uuid::Uuid::new_v4().to_string();

    let pa = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id,
                name: "Test Agent".into(),
                org_id: None,
                role: Some("developer".into()),
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                instance_role: None,
                source: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    let session = storage
        .create_session(
            &pa.id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.clone(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    assert!(!session.id.is_empty());
    // `include_empty`: the freshly created session has no events yet,
    // and the plain list (migration 0014 parity) filters event-less rows.
    assert_eq!(
        storage
            .list_sessions_including_empty(&pa.id, TEST_JWT)
            .await
            .unwrap()
            .len(),
        1,
    );

    // Act: DELETE via the server route.
    let uri = format!(
        "/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}",
        pa_id = pa.id,
        session_id = session.id,
    );
    let req = json_request("DELETE", &uri, None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert: session is gone from storage. `include_empty` so the
    // check proves real deletion rather than empty-row filtering.
    let sessions = storage
        .list_sessions_including_empty(&pa.id, TEST_JWT)
        .await
        .unwrap();
    assert!(sessions.is_empty(), "session should be removed");

    // A follow-up GET should now 404 at the proxy.
    let get_uri = format!(
        "/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}",
        pa_id = pa.id,
        session_id = session.id,
    );
    let resp = app
        .clone()
        .oneshot(json_request("GET", &get_uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_session_returns_404_for_unknown_id() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();

    let uri = format!("/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}");
    let resp = app
        .clone()
        .oneshot(json_request("DELETE", &uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// Regression for the original "right-click Delete session does
/// nothing" report: when aura-storage rejects DELETE with a non-404
/// upstream status (here a 409), `delete_session` used to collapse it
/// into an opaque 500 (`internal_error`) with no server-side log.
/// After the diagnostic-mapping fix the handler must surface the
/// upstream status so the FE error banner can show
/// "Couldn't delete session (409): ..." instead of a flat 500.
#[tokio::test]
async fn delete_session_preserves_non_404_upstream_status() {
    let mock_storage = Router::new().route(
        "/api/sessions/:session_id",
        delete(|| async {
            (
                StatusCode::CONFLICT,
                axum::Json(serde_json::json!({
                    "error": "session has unfinished tasks",
                    "code": "session_in_use",
                })),
            )
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, mock_storage).await.ok() });

    let storage = Arc::new(StorageClient::with_base_url(&storage_url));
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        Some(storage),
        None,
        None,
    );

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let uri = format!("/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}");

    let req = Request::builder()
        .method("DELETE")
        .uri(&uri)
        .header("authorization", format!("Bearer {}", TEST_JWT))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::CONFLICT,
        "non-404 upstream status must pass through (was previously 500)",
    );
}

#[tokio::test]
async fn delete_session_falls_back_to_soft_delete_when_storage_rejects_delete_method() {
    let recorded_update: Arc<Mutex<Option<UpdateSessionRequest>>> = Arc::new(Mutex::new(None));
    let update_sink = recorded_update.clone();
    let mock_storage = Router::new().route(
        "/api/sessions/:session_id",
        delete(|| async { (StatusCode::METHOD_NOT_ALLOWED, "storage error") }).put(
            move |Path(_session_id): Path<String>, Json(req): Json<UpdateSessionRequest>| {
                let update_sink = update_sink.clone();
                async move {
                    *update_sink.lock().await = Some(req);
                    StatusCode::OK
                }
            },
        ),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let storage_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, mock_storage).await.ok() });

    let storage = Arc::new(StorageClient::with_base_url(&storage_url));
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        Some(storage),
        None,
        None,
    );

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let uri = format!("/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}");

    let req = Request::builder()
        .method("DELETE")
        .uri(&uri)
        .header("authorization", format!("Bearer {}", TEST_JWT))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let update = recorded_update
        .lock()
        .await
        .take()
        .expect("fallback PUT should mark session deleted");
    assert_eq!(update.status.as_deref(), Some(SESSION_STATUS_DELETED));
    assert_eq!(update.is_public, Some(false));
    assert!(
        update.ended_at.is_some(),
        "soft delete should stamp ended_at so the row stops looking active",
    );
}
