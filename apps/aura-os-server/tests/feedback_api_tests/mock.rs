//! In-process mock of aura-network used to exercise the feedback proxy.

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

use aura_os_network::NetworkClient;

use super::common::*;

pub(crate) const FEEDBACK_EVENT_TYPE: &str = "feedback";

pub(crate) fn new_event_id() -> String {
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

pub(crate) fn seed_feed_event(profile_id: &str, event_type: &str, created_at: &str) -> Value {
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

pub(crate) struct MockNetwork {
    events: Arc<StdMutex<Vec<Value>>>,
    comments: Arc<StdMutex<HashMap<String, Vec<Value>>>>,
    /// post_id -> (profile_id -> vote_value). Value = 1 (up) or -1 (down).
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
                                Some(event) => {
                                    (StatusCode::OK, Json(inflate_event(&event, &votes, &viewer)))
                                }
                                None => {
                                    (StatusCode::NOT_FOUND, Json(json!({"error": "not found"})))
                                }
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
                                    (StatusCode::OK, Json(inflate_event(event, &votes, &viewer)))
                                }
                                None => {
                                    (StatusCode::NOT_FOUND, Json(json!({"error": "not found"})))
                                }
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

pub(crate) async fn build_test_app_with_feedback_network(
    seed_events: Vec<Value>,
) -> (Router, tempfile::TempDir) {
    use aura_os_store::SettingsStore;

    let mock = MockNetwork::new(seed_events);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, mock.router()).await.ok() });

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, _state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(Arc::new(NetworkClient::with_base_url(&format!(
            "http://{addr}"
        )))),
        None,
        None,
        None,
    );
    (app, store_dir)
}

pub(crate) fn response_status(response: &axum::http::Response<Body>) -> StatusCode {
    response.status()
}
