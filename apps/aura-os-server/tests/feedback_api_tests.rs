//! Integration tests for the Aura OS feedback HTTP surface.
//!
//! A minimal in-process mock of aura-network stands in for the upstream service
//! so we can exercise list/create/comment/vote/status round-trips without
//! depending on a live Postgres or aura-network process. The mock tracks
//! per-profile votes in-memory so the vote contract (one active vote per user)
//! is exercised end-to-end through the Aura OS proxy.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use axum::body::Body;
use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_network::NetworkClient;

use common::*;

const FEEDBACK_EVENT_TYPE: &str = "feedback";

fn new_event_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn merge_object(target: &mut Value, patch: &Value) {
    if !patch.is_object() {
        return;
    }
    let target_obj = match target.as_object_mut() {
        Some(obj) => obj,
        None => {
            *target = json!({});
            target.as_object_mut().unwrap()
        }
    };
    for (key, value) in patch.as_object().unwrap() {
        if value.is_null() {
            target_obj.remove(key);
        } else {
            target_obj.insert(key.clone(), value.clone());
        }
    }
}

fn seed_feed_event(profile_id: &str, event_type: &str, created_at: &str) -> Value {
    json!({
        "id": new_event_id(),
        "profileId": profile_id,
        "eventType": event_type,
        "postType": "post",
        "title": format!("{event_type} seed"),
        "summary": "seeded",
        "metadata": if event_type == FEEDBACK_EVENT_TYPE {
            json!({
                "feedbackCategory": "bug",
                "feedbackStatus": "not_started",
                "body": "seeded body",
            })
        } else {
            Value::Null
        },
        "commentCount": 0,
        "createdAt": created_at,
        "upvotes": 0,
        "downvotes": 0,
        "voteScore": 0,
        "viewerVote": "none",
    })
}

type VotesByPost = HashMap<String, HashMap<String, i16>>;

struct MockNetwork {
    events: Arc<StdMutex<Vec<Value>>>,
    comments: Arc<StdMutex<HashMap<String, Vec<Value>>>>,
    /// post_id → (profile_id → vote_value). Value = 1 (up) or -1 (down).
    votes: Arc<StdMutex<VotesByPost>>,
    /// The profile the mock attributes every Aura OS request to. This stands
    /// in for the aura-network "resolve profile from JWT" step.
    viewer_profile_id: String,
}

fn vote_summary(votes: &VotesByPost, post_id: &str, viewer: &str) -> Value {
    let empty: HashMap<String, i16> = HashMap::new();
    let per_post = votes.get(post_id).unwrap_or(&empty);
    let upvotes = per_post.values().filter(|v| **v == 1).count() as i64;
    let downvotes = per_post.values().filter(|v| **v == -1).count() as i64;
    let viewer_vote = match per_post.get(viewer).copied() {
        Some(1) => "up",
        Some(-1) => "down",
        _ => "none",
    };
    json!({
        "upvotes": upvotes,
        "downvotes": downvotes,
        "score": upvotes - downvotes,
        "viewerVote": viewer_vote,
    })
}

fn inflate_event(event: &Value, votes: &VotesByPost, viewer: &str) -> Value {
    let id = event.get("id").and_then(Value::as_str).unwrap_or("");
    let summary = vote_summary(votes, id, viewer);
    let mut out = event.clone();
    let map = out.as_object_mut().unwrap();
    map.insert("upvotes".into(), summary["upvotes"].clone());
    map.insert("downvotes".into(), summary["downvotes"].clone());
    map.insert("voteScore".into(), summary["score"].clone());
    map.insert("viewerVote".into(), summary["viewerVote"].clone());
    out
}

impl MockNetwork {
    fn new(seed_events: Vec<Value>) -> Self {
        Self {
            events: Arc::new(StdMutex::new(seed_events)),
            comments: Arc::new(StdMutex::new(HashMap::new())),
            votes: Arc::new(StdMutex::new(HashMap::new())),
            viewer_profile_id: "00000000-0000-0000-0000-000000000001".to_string(),
        }
    }

    fn router(&self) -> Router {
        let events_for_feed = self.events.clone();
        let votes_for_feed = self.votes.clone();
        let viewer_for_feed = self.viewer_profile_id.clone();

        let events_for_create = self.events.clone();
        let events_for_get = self.events.clone();
        let events_for_patch = self.events.clone();
        let votes_for_get = self.votes.clone();
        let votes_for_patch = self.votes.clone();
        let viewer_for_get = self.viewer_profile_id.clone();
        let viewer_for_patch = self.viewer_profile_id.clone();

        let comments_for_list = self.comments.clone();
        let comments_for_add = self.comments.clone();

        let events_for_vote = self.events.clone();
        let votes_for_cast = self.votes.clone();
        let viewer_for_vote = self.viewer_profile_id.clone();

        Router::new()
            .route(
                "/api/feed",
                get(move |Query(q): Query<HashMap<String, String>>| {
                    let events = events_for_feed.clone();
                    let votes = votes_for_feed.clone();
                    let viewer = viewer_for_feed.clone();
                    async move {
                        let snapshot = events.lock().unwrap().clone();
                        let votes = votes.lock().unwrap();
                        let filter = q.get("filter").cloned();
                        let mut items: Vec<Value> = snapshot
                            .into_iter()
                            .filter(|e| match filter.as_deref() {
                                Some("feedback") => {
                                    e.get("eventType").and_then(Value::as_str)
                                        == Some(FEEDBACK_EVENT_TYPE)
                                }
                                _ => true,
                            })
                            .map(|e| inflate_event(&e, &votes, &viewer))
                            .collect();
                        items.sort_by(|a, b| {
                            b.get("createdAt")
                                .and_then(Value::as_str)
                                .cmp(&a.get("createdAt").and_then(Value::as_str))
                        });
                        Json(items)
                    }
                }),
            )
            .route(
                "/api/posts",
                post(move |Json(body): Json<Value>| {
                    let events = events_for_create.clone();
                    async move {
                        let id = new_event_id();
                        let profile_id = body
                            .get("profileId")
                            .and_then(Value::as_str)
                            .unwrap_or("00000000-0000-0000-0000-000000000001")
                            .to_string();
                        let created_at = chrono::Utc::now().to_rfc3339();
                        let mut record = json!({
                            "id": id,
                            "profileId": profile_id,
                            "eventType": body.get("eventType").cloned().unwrap_or(Value::Null),
                            "postType": body.get("postType").cloned().unwrap_or(Value::Null),
                            "title": body.get("title").cloned().unwrap_or(Value::Null),
                            "summary": body.get("summary").cloned().unwrap_or(Value::Null),
                            "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
                            "commentCount": 0,
                            "createdAt": created_at,
                            "upvotes": 0,
                            "downvotes": 0,
                            "voteScore": 0,
                            "viewerVote": "none",
                        });
                        if let Some(map) = record.as_object_mut() {
                            for key in ["orgId", "projectId", "agentId", "userId", "pushId"] {
                                if let Some(value) = body.get(key) {
                                    if !value.is_null() {
                                        map.insert(key.to_string(), value.clone());
                                    }
                                }
                            }
                        }
                        events.lock().unwrap().push(record.clone());
                        (StatusCode::CREATED, Json(record))
                    }
                }),
            )
            .route(
                "/api/posts/:post_id",
                get({
                    let events_for_get = events_for_get.clone();
                    let votes_for_get = votes_for_get.clone();
                    let viewer_for_get = viewer_for_get.clone();
                    move |Path(post_id): Path<String>| {
                        let events = events_for_get.clone();
                        let votes = votes_for_get.clone();
                        let viewer = viewer_for_get.clone();
                        async move {
                            let snapshot = events.lock().unwrap().clone();
                            let votes = votes.lock().unwrap();
                            match snapshot
                                .into_iter()
                                .find(|e| e.get("id").and_then(Value::as_str) == Some(&post_id))
                            {
                                Some(event) => (
                                    StatusCode::OK,
                                    Json(inflate_event(&event, &votes, &viewer)),
                                ),
                                None => (
                                    StatusCode::NOT_FOUND,
                                    Json(json!({"error": "not found"})),
                                ),
                            }
                        }
                    }
                })
                .patch({
                    let events_for_patch = events_for_patch.clone();
                    let votes_for_patch = votes_for_patch.clone();
                    let viewer_for_patch = viewer_for_patch.clone();
                    move |Path(post_id): Path<String>, Json(body): Json<Value>| {
                        let events = events_for_patch.clone();
                        let votes = votes_for_patch.clone();
                        let viewer = viewer_for_patch.clone();
                        async move {
                            let mut list = events.lock().unwrap();
                            let found = list
                                .iter_mut()
                                .find(|e| e.get("id").and_then(Value::as_str) == Some(&post_id));
                            match found {
                                Some(event) => {
                                    if let Some(patch) = body.get("metadata") {
                                        let metadata_slot = event
                                            .as_object_mut()
                                            .unwrap()
                                            .entry("metadata".to_string())
                                            .or_insert_with(|| json!({}));
                                        if metadata_slot.is_null() {
                                            *metadata_slot = json!({});
                                        }
                                        merge_object(metadata_slot, patch);
                                    }
                                    let votes = votes.lock().unwrap();
                                    (
                                        StatusCode::OK,
                                        Json(inflate_event(event, &votes, &viewer)),
                                    )
                                }
                                None => (
                                    StatusCode::NOT_FOUND,
                                    Json(json!({"error": "not found"})),
                                ),
                            }
                        }
                    }
                }),
            )
            .route(
                "/api/posts/:post_id/votes",
                post({
                    let events_for_vote = events_for_vote.clone();
                    let votes_for_cast = votes_for_cast.clone();
                    let viewer_for_vote = viewer_for_vote.clone();
                    move |Path(post_id): Path<String>, Json(body): Json<Value>| {
                        let events = events_for_vote.clone();
                        let votes = votes_for_cast.clone();
                        let viewer = viewer_for_vote.clone();
                        async move {
                            let event_exists = events
                                .lock()
                                .unwrap()
                                .iter()
                                .any(|e| e.get("id").and_then(Value::as_str) == Some(&post_id));
                            if !event_exists {
                                return (
                                    StatusCode::NOT_FOUND,
                                    Json(json!({"error": "not found"})),
                                );
                            }
                            let vote = body.get("vote").and_then(Value::as_str).unwrap_or("");
                            let numeric = match vote {
                                "up" => Some(1i16),
                                "down" => Some(-1i16),
                                "none" => None,
                                _ => {
                                    return (
                                        StatusCode::BAD_REQUEST,
                                        Json(json!({"error": "invalid vote"})),
                                    )
                                }
                            };
                            let mut guard = votes.lock().unwrap();
                            let entry = guard.entry(post_id.clone()).or_default();
                            match numeric {
                                Some(v) => {
                                    entry.insert(viewer.clone(), v);
                                }
                                None => {
                                    entry.remove(&viewer);
                                }
                            }
                            let summary = vote_summary(&guard, &post_id, &viewer);
                            (StatusCode::OK, Json(summary))
                        }
                    }
                }),
            )
            .route(
                "/api/posts/:post_id/comments",
                get(move |Path(post_id): Path<String>| {
                    let comments = comments_for_list.clone();
                    async move {
                        let snapshot = comments
                            .lock()
                            .unwrap()
                            .get(&post_id)
                            .cloned()
                            .unwrap_or_default();
                        Json(snapshot)
                    }
                })
                .post(
                    move |Path(post_id): Path<String>, Json(body): Json<Value>| {
                        let comments = comments_for_add.clone();
                        async move {
                            let id = new_event_id();
                            let content = body
                                .get("content")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let created_at = chrono::Utc::now().to_rfc3339();
                            let record = json!({
                                "id": id,
                                "activityEventId": post_id,
                                "profileId": "00000000-0000-0000-0000-000000000001",
                                "content": content,
                                "createdAt": created_at,
                            });
                            comments
                                .lock()
                                .unwrap()
                                .entry(post_id)
                                .or_default()
                                .push(record.clone());
                            (StatusCode::CREATED, Json(record))
                        }
                    },
                ),
            )
    }
}

async fn build_test_app_with_feedback_network(
    seed_events: Vec<Value>,
) -> (Router, tempfile::TempDir) {
    use aura_os_store::RocksStore;

    let mock = MockNetwork::new(seed_events);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, mock.router()).await.ok() });

    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, _state) = build_test_app_from_store(
        store,
        db_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&format!(
            "http://{addr}"
        )))),
        None,
        None,
        None,
    );
    (app, db_dir)
}

fn response_status(response: &axum::http::Response<Body>) -> StatusCode {
    response.status()
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_feedback_filters_to_feedback_event_type() {
    let seed = vec![
        seed_feed_event(
            "00000000-0000-0000-0000-00000000aaaa",
            "post",
            "2026-04-17T00:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000bbbb",
            FEEDBACK_EVENT_TYPE,
            "2026-04-17T01:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000cccc",
            "push",
            "2026-04-17T02:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000dddd",
            FEEDBACK_EVENT_TYPE,
            "2026-04-17T03:00:00Z",
        ),
    ];
    let (app, _db) = build_test_app_with_feedback_network(seed).await;

    let req = json_request("GET", "/api/feedback", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);

    let body = response_json(resp).await;
    let items = body.as_array().expect("list is an array");
    assert_eq!(items.len(), 2, "only feedback event_type items surface");
    for item in items {
        assert_eq!(item["eventType"], FEEDBACK_EVENT_TYPE);
    }
    assert_eq!(items[0]["createdAt"], "2026-04-17T03:00:00Z");
    assert_eq!(items[1]["createdAt"], "2026-04-17T01:00:00Z");
}

#[tokio::test]
async fn list_feedback_rejects_unknown_sort() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request("GET", "/api/feedback?sort=spaghetti", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Create validation + round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_feedback_rejects_unknown_category() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "body",
            "category": "not-a-category",
            "status": "not_started",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_rejects_unknown_status() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "body",
            "category": "bug",
            "status": "definitely-not-a-status",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_rejects_empty_body() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "   ",
            "category": "bug",
            "status": "not_started",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_round_trip_shows_up_in_list() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "title": "Keyboard shortcuts please",
            "body": "Cmd+1/2/3 to focus panels",
            "category": "feature_request",
            "status": "not_started",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["eventType"], FEEDBACK_EVENT_TYPE);
    assert_eq!(body["postType"], "post");
    assert_eq!(body["category"], "feature_request");
    assert_eq!(body["status"], "not_started");
    assert_eq!(body["upvotes"], 0);
    assert_eq!(body["viewerVote"], "none");

    let req = json_request("GET", "/api/feedback", None);
    let list = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&list), StatusCode::OK);
    let items = response_json(list).await;
    let array = items.as_array().expect("list array");
    assert_eq!(array.len(), 1);
    assert_eq!(array[0]["title"], "Keyboard shortcuts please");
}

// ---------------------------------------------------------------------------
// get_feedback filters non-feedback posts out
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_feedback_returns_404_for_non_feedback_post() {
    let seed = vec![seed_feed_event(
        "00000000-0000-0000-0000-00000000aaaa",
        "post",
        "2026-04-17T00:00:00Z",
    )];
    let post_id = seed[0]["id"].as_str().unwrap().to_string();
    let (app, _db) = build_test_app_with_feedback_network(seed).await;

    let req = json_request("GET", &format!("/api/feedback/{post_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Comments round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
async fn feedback_comment_round_trip() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "Please add dark mode",
            "category": "feature_request",
            "status": "not_started",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    assert_eq!(response_status(&created), StatusCode::CREATED);
    let post = response_json(created).await;
    let post_id = post["id"].as_str().unwrap().to_string();

    let add_comment = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/comments"),
        Some(json!({"content": "agreed"})),
    );
    let resp = app.clone().oneshot(add_comment).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["content"], "agreed");

    let list = json_request("GET", &format!("/api/feedback/{post_id}/comments"), None);
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let items = response_json(resp).await;
    let array = items.as_array().expect("array");
    assert_eq!(array.len(), 1);
    assert_eq!(array[0]["content"], "agreed");
}

#[tokio::test]
async fn add_comment_rejects_empty_content() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "something",
            "category": "bug",
            "status": "not_started",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    let post_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let req = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/comments"),
        Some(json!({"content": "   "})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Phase 3: status PATCH forwards to aura-network
// ---------------------------------------------------------------------------

#[tokio::test]
async fn status_update_rejects_unknown_status() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "PATCH",
        "/api/feedback/any-id/status",
        Some(json!({"status": "schrodinger"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn status_update_merges_status_into_metadata() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    // Create a feedback item.
    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "something",
            "category": "bug",
            "status": "not_started",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    let post_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Update the status.
    let patch = json_request(
        "PATCH",
        &format!("/api/feedback/{post_id}/status"),
        Some(json!({"status": "in_progress"})),
    );
    let resp = app.clone().oneshot(patch).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["status"], "in_progress");
    assert_eq!(body["category"], "bug", "category is preserved");
}

// ---------------------------------------------------------------------------
// Phase 3: vote POST forwards to aura-network and returns aggregates
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cast_vote_rejects_unknown_value() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "POST",
        "/api/feedback/any-id/vote",
        Some(json!({"vote": "sideways"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn cast_vote_toggle_flow_up_down_none() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "vote me",
            "category": "feature_request",
            "status": "not_started",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    let post_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Up.
    let up = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "up"})),
    );
    let resp = app.clone().oneshot(up).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let summary = response_json(resp).await;
    assert_eq!(summary["upvotes"], 1);
    assert_eq!(summary["downvotes"], 0);
    assert_eq!(summary["voteScore"], 1);
    assert_eq!(summary["viewerVote"], "up");

    // Switch to down — still one active vote, just flipped.
    let down = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "down"})),
    );
    let resp = app.clone().oneshot(down).await.unwrap();
    let summary = response_json(resp).await;
    assert_eq!(summary["upvotes"], 0);
    assert_eq!(summary["downvotes"], 1);
    assert_eq!(summary["voteScore"], -1);
    assert_eq!(summary["viewerVote"], "down");

    // Clear.
    let none = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "none"})),
    );
    let resp = app.clone().oneshot(none).await.unwrap();
    let summary = response_json(resp).await;
    assert_eq!(summary["upvotes"], 0);
    assert_eq!(summary["downvotes"], 0);
    assert_eq!(summary["voteScore"], 0);
    assert_eq!(summary["viewerVote"], "none");
}

#[tokio::test]
async fn list_surfaces_vote_aggregates_from_upstream() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "vote me",
            "category": "feature_request",
            "status": "not_started",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    let post_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let up = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "up"})),
    );
    app.clone().oneshot(up).await.unwrap();

    let list = json_request("GET", "/api/feedback", None);
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let items = response_json(resp).await;
    let arr = items.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["upvotes"], 1);
    assert_eq!(arr[0]["voteScore"], 1);
    assert_eq!(arr[0]["viewerVote"], "up");
}
