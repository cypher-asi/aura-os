//! Integration test for filtering zero-event sessions out of
//! `GET /api/projects/:p/sessions` and
//! `GET /api/projects/:p/agents/:a/sessions`.
//!
//! Sessions get created in storage *before* the first user message is
//! persisted (see `create_new_chat_session` in
//! `apps/aura-os-server/src/handlers/agents/chat/persist.rs`), so any
//! race or persist failure on the very first turn leaves an orphan
//! row with no events. Plus there's pre-`lazy-+` legacy data in
//! storage from before the chat-input "+" became lazy. These would
//! render in the chats sidekick as unclickable "New chat" rows; the
//! API now drops them.
//!
//! As of aura-storage migration `0014_add_session_event_tracking`,
//! the empty-row filter lives in aura-storage itself: the public
//! list endpoints select on `event_count > 0`, maintained by the
//! `session_events_after_insert` trigger. aura-os-server is a
//! straight pass-through (no per-session `list_events?limit=1`
//! probes), and these tests verify the through-pass behavior against
//! the in-memory mock which mirrors that filter.

mod common;

use std::sync::Arc;

use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, StorageClient,
    UpdateSessionRequest, SESSION_STATUS_DELETED,
};

use common::*;

async fn seed_project_agent(
    storage: &StorageClient,
    project_id: &str,
) -> aura_os_storage::StorageProjectAgent {
    storage
        .create_project_agent(
            project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
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
        .expect("create project agent")
}

async fn seed_session(
    storage: &StorageClient,
    project_id: &str,
    project_agent_id: &str,
) -> aura_os_storage::StorageSession {
    storage
        .create_session(
            project_agent_id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.into(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session")
}

async fn seed_user_event(storage: &StorageClient, session_id: &str) {
    storage
        .create_event(
            session_id,
            TEST_JWT,
            &CreateSessionEventRequest {
                session_id: Some(session_id.into()),
                user_id: None,
                agent_id: None,
                sender: Some("user".into()),
                project_id: None,
                org_id: None,
                event_type: "user_message".into(),
                content: Some(serde_json::json!({ "text": "hi" })),
            },
        )
        .await
        .expect("create event");
}

async fn mark_session_deleted(storage: &StorageClient, session_id: &str) {
    storage
        .update_session(
            session_id,
            TEST_JWT,
            &UpdateSessionRequest {
                status: Some(SESSION_STATUS_DELETED.to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("mark session deleted");
}

async fn fetch_session_ids(app: &Router, uri: &str) -> Vec<String> {
    let resp = app
        .clone()
        .oneshot(json_request("GET", uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "GET {uri}");
    let body = response_json(resp).await;
    let arr = body.as_array().expect("array of sessions");
    arr.iter()
        .map(|s| {
            s.get("session_id")
                .and_then(Value::as_str)
                .expect("session_id string")
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn list_project_sessions_filters_sessions_with_no_events() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;

    let with_events = seed_session(&storage, &project_id, &pa.id).await;
    let empty = seed_session(&storage, &project_id, &pa.id).await;
    let deleted_with_events = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &with_events.id).await;
    seed_user_event(&storage, &deleted_with_events.id).await;
    mark_session_deleted(&storage, &deleted_with_events.id).await;

    let ids = fetch_session_ids(&app, &format!("/api/projects/{project_id}/sessions")).await;
    assert!(ids.contains(&with_events.id), "session with events stays");
    assert!(
        !ids.contains(&empty.id),
        "session with no events filtered out, got {ids:?}",
    );
    assert!(
        !ids.contains(&deleted_with_events.id),
        "deleted session with events filtered out, got {ids:?}",
    );
}

#[tokio::test]
async fn list_sessions_filters_sessions_with_no_events() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;

    let with_events = seed_session(&storage, &project_id, &pa.id).await;
    let empty = seed_session(&storage, &project_id, &pa.id).await;
    let deleted_with_events = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &with_events.id).await;
    seed_user_event(&storage, &deleted_with_events.id).await;
    mark_session_deleted(&storage, &deleted_with_events.id).await;

    let pa_id = pa.id.clone();
    let ids = fetch_session_ids(
        &app,
        &format!("/api/projects/{project_id}/agents/{pa_id}/sessions"),
    )
    .await;
    assert_eq!(
        ids,
        vec![with_events.id.clone()],
        "only the live session with events remains (empty {} and deleted {} filtered)",
        empty.id,
        deleted_with_events.id,
    );
}

// The previous `list_sessions_keeps_rows_when_events_probe_errors`
// test verified fail-open behavior of `filter_nonempty_sessions` in
// aura-os-server. That probe is gone — aura-storage filters
// `event_count > 0` directly via the `idx_sessions_pa_recent` /
// `idx_sessions_project_recent` partial indexes (migration 0014), so
// there is no probe round-trip that could fail. If aura-storage's
// list endpoint itself errors, the entire list call propagates the
// upstream error to the UI, which is the correct behavior: the
// sidekick should refuse to render rather than render half-truth.

/// Stamp ownership of `session_id` on `user_id` directly in the mock
/// db. Real aura-storage stores `created_by` on the `sessions` row
/// and derives the user_id from the JWT in `/api/me/sessions`; the
/// mock has no auth, so the StorageClient appends a `?user=<id>`
/// query param when `AURA_STORAGE_TEST_USER_ID` is set and the mock
/// reads ownership from this side map.
async fn stamp_session_owner(
    db: &aura_os_storage::testutil::SharedDb,
    session_id: &str,
    user_id: &str,
) {
    db.lock()
        .await
        .session_users
        .insert(session_id.to_string(), user_id.to_string());
}

#[tokio::test]
async fn list_my_sessions_returns_only_users_sessions() {
    let (app, _state, storage, db, _store_dir) = build_test_app_with_storage_db().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;

    let user_a = uuid::Uuid::new_v4().to_string();
    let user_b = uuid::Uuid::new_v4().to_string();

    let mine_with_events = seed_session(&storage, &project_id, &pa.id).await;
    let mine_empty = seed_session(&storage, &project_id, &pa.id).await;
    let mine_deleted_with_events = seed_session(&storage, &project_id, &pa.id).await;
    let other_user_with_events = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &mine_with_events.id).await;
    seed_user_event(&storage, &mine_deleted_with_events.id).await;
    seed_user_event(&storage, &other_user_with_events.id).await;
    mark_session_deleted(&storage, &mine_deleted_with_events.id).await;

    stamp_session_owner(&db, &mine_with_events.id, &user_a).await;
    stamp_session_owner(&db, &mine_empty.id, &user_a).await;
    stamp_session_owner(&db, &mine_deleted_with_events.id, &user_a).await;
    stamp_session_owner(&db, &other_user_with_events.id, &user_b).await;

    // The mock filters by `?user=<id>` (matching the env var the
    // StorageClient sets); set it for the duration of this test so
    // the cross-agent fetch scopes to user A. No-op against real
    // aura-storage in production -- the JWT is the sole authority
    // there.
    std::env::set_var("AURA_STORAGE_TEST_USER_ID", &user_a);
    let ids = fetch_session_ids(&app, "/api/me/sessions").await;
    std::env::remove_var("AURA_STORAGE_TEST_USER_ID");

    assert!(
        ids.contains(&mine_with_events.id),
        "user A's non-empty session present, got {ids:?}",
    );
    assert!(
        !ids.contains(&mine_empty.id),
        "user A's empty session filtered (event_count > 0 only by default), got {ids:?}",
    );
    assert!(
        !ids.contains(&mine_deleted_with_events.id),
        "user A's deleted session filtered, got {ids:?}",
    );
    assert!(
        !ids.contains(&other_user_with_events.id),
        "user B's session must not surface in user A's request, got {ids:?}",
    );
}

#[tokio::test]
async fn deleted_session_direct_reads_return_404() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;
    let deleted = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &deleted.id).await;
    mark_session_deleted(&storage, &deleted.id).await;

    let session_uri = format!(
        "/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}",
        pa_id = pa.id,
        session_id = deleted.id,
    );
    let resp = app
        .clone()
        .oneshot(json_request("GET", &session_uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let events_uri = format!("{session_uri}/events");
    let resp = app
        .clone()
        .oneshot(json_request("GET", &events_uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let paginated_events_uri = format!("{session_uri}/events/paginated");
    let resp = app
        .clone()
        .oneshot(json_request("GET", &paginated_events_uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let share_uri = format!("{session_uri}/share");
    let resp = app
        .clone()
        .oneshot(json_request("POST", &share_uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn deleted_public_share_returns_404() {
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(StorageClient::with_base_url_and_token(
        &storage_url,
        "test-internal-token",
    ));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);
    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        None,
        Some(storage.clone()),
        None,
        None,
    );

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa = seed_project_agent(&storage, &project_id).await;
    let deleted = seed_session(&storage, &project_id, &pa.id).await;
    seed_user_event(&storage, &deleted.id).await;

    let token = format!("t_{}", uuid::Uuid::new_v4().simple());
    storage
        .update_session(
            &deleted.id,
            TEST_JWT,
            &UpdateSessionRequest {
                is_public: Some(true),
                public_share_id: Some(token.clone()),
                ..Default::default()
            },
        )
        .await
        .expect("mark session public");
    mark_session_deleted(&storage, &deleted.id).await;

    let resp = app
        .clone()
        .oneshot(json_request(
            "GET",
            &format!("/api/public/share/{token}"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn paginated_events_fail_closed_when_session_lookup_errors() {
    let storage_app = Router::new()
        .route(
            "/api/sessions/:session_id",
            get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        )
        .route(
            "/api/sessions/:session_id/events",
            get(|| async { axum::Json(Vec::<Value>::new()) }),
        );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock storage");
    let storage_url = format!("http://{}", listener.local_addr().expect("storage addr"));
    tokio::spawn(async move { axum::serve(listener, storage_app).await.ok() });
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

    let project_id = uuid::Uuid::new_v4();
    let agent_instance_id = uuid::Uuid::new_v4();
    let session_id = uuid::Uuid::new_v4();
    let uri = format!(
        "/api/projects/{project_id}/agents/{agent_instance_id}/sessions/{session_id}/events/paginated"
    );
    let resp = app
        .clone()
        .oneshot(json_request("GET", &uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
