//! Phase 7 (final phase) of the `send_to_agent` cross-agent UX fix.
//!
//! End-to-end integration test for the server-side cross-agent reply
//! loop landed in Phases 1-3:
//!
//! * Phase 1 (aura-harness `6a9b33d`) — `send_to_agent` ships
//!   `originating_agent_id` on the inbound POST body.
//! * Phase 2 (aura-os `1d01f6e01`) — server threads the field onto
//!   `SendChatRequest` ⇒ `ChatPersistCtx`.
//! * Phase 3 (aura-os `6d4b70664`) — on `AssistantMessageEnd`,
//!   [`crate::handlers::agents::chat::cross_agent_reply::spawn_cross_agent_reply_callback`]
//!   fires a fire-and-forget POST back into A's session carrying B's
//!   reply as a `user_message`.
//!
//! The unit tests in `cross_agent_reply.rs` already pin the pure
//! helpers (`should_send_cross_agent_reply`, `truncate_for_cross_agent_reply`,
//! `read_cross_agent_depth`); this file is the missing **HTTP-level**
//! coverage — a real `axum::Router` driving the bare-agent route, a
//! real harness double (`FakeHarness`) emitting the scripted
//! `TextDelta` + `AssistantMessageEnd`, and a real loopback HTTP
//! server pretending to be agent A's side of the cross-repo callback.
//!
//! The three scenarios covered here are:
//!
//! 1. `cross_agent_reply_callback_fires_on_assistant_message_end` —
//!    happy path. POST to `/api/agents/<B>/events/stream` with
//!    `originating_agent_id: "A"`, harness emits the assistant turn,
//!    callback POSTs back to mock A-server with depth header
//!    incremented to `1`, body's `originating_agent_id: null`,
//!    `content` containing the harness reply text. **Load-bearing for
//!    Phase 3** — pins the depth-increment + single-hop fall-off
//!    contract.
//!
//! 2. `cross_agent_callback_skipped_when_originating_agent_id_missing` —
//!    same flow but `originating_agent_id` omitted. Asserts ZERO
//!    captures on the mock A-server. **Load-bearing for Phase 2** —
//!    pins the "no upstream sender ⇒ no auto-reply" contract.
//!
//! 3. `cross_agent_callback_skipped_at_max_depth` — same flow but
//!    inbound `X-Aura-Cross-Agent-Depth: 4` header. Asserts ZERO
//!    captures. **Load-bearing for Phase 3** — pins the
//!    `MAX_CROSS_AGENT_REPLY_DEPTH` cycle guard.
//!
//! Cross-test isolation: all three tests mutate the process-wide
//! `AURA_SERVER_BASE_URL` env var (read fresh inside
//! [`aura_os_integrations::control_plane_api_base_url`]) and bind a
//! fresh mock A-server on a random port. A static `Mutex` serializes
//! them so a parallel run of two tests in this file does not flip the
//! env var out from under another test's in-flight callback. Other
//! integration tests in the crate live in their own test binaries and
//! run as separate processes, so they cannot collide with this lock.

mod common;

use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use axum::extract::Path as AxumPath;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_harness::test_support::FakeHarness;
use aura_os_harness::{
    AssistantMessageEnd, FilesChanged, HarnessLink, HarnessOutbound, SessionUsage, TextDelta,
};
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{CreateProjectAgentRequest, StorageClient};

use common::*;

// ---------------------------------------------------------------------------
// Cross-test env-var serialization.
// ---------------------------------------------------------------------------

/// Process-wide guard: every test in this file mutates
/// `AURA_SERVER_BASE_URL` and depends on
/// [`aura_os_integrations::control_plane_api_base_url`] reading the
/// override fresh on every cross-agent callback. Holding this lock
/// across the whole test body (including the `await` on the
/// callback) keeps two parallel tests from stomping on each other's
/// env. Mirrors the `env_lock` pattern in
/// `tests/remote_harness_base_url_test.rs`.
fn env_lock() -> &'static StdMutex<()> {
    static LOCK: StdMutex<()> = StdMutex::new(());
    &LOCK
}

struct EnvGuard {
    key: &'static str,
    prev: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let prev = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

// ---------------------------------------------------------------------------
// Mock "A-server" — captures the cross-agent reply callback.
// ---------------------------------------------------------------------------

/// One captured cross-agent callback POST. Cloned out of the
/// `Mutex<Vec<_>>` so test assertions never hold the lock across
/// `assert!` panic unwinds.
#[derive(Debug, Clone)]
struct CapturedReply {
    method: Method,
    path: String,
    /// Lowercased depth header value, or `None` when absent.
    depth_header: Option<String>,
    /// Bearer token observed (without the `Bearer ` prefix), if any.
    bearer: Option<String>,
    body: Value,
}

#[derive(Default)]
struct ReplyCaptures {
    items: StdMutex<Vec<CapturedReply>>,
    /// Optional one-shot signal fired the moment the FIRST capture
    /// lands. Tests use this to await the fire-and-forget callback
    /// without busy-looping. Filled by [`MockAServer::on_first`] at
    /// setup time.
    notify_first: StdMutex<Option<oneshot::Sender<()>>>,
}

impl ReplyCaptures {
    fn new(notify_first: oneshot::Sender<()>) -> Self {
        Self {
            items: StdMutex::new(Vec::new()),
            notify_first: StdMutex::new(Some(notify_first)),
        }
    }

    fn snapshot(&self) -> Vec<CapturedReply> {
        self.items.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn record(&self, capture: CapturedReply) {
        {
            let mut items = self.items.lock().unwrap_or_else(|p| p.into_inner());
            items.push(capture);
        }
        if let Some(tx) = self
            .notify_first
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            // First capture — release the test from its `await`. A
            // second / third capture during the same test (shouldn't
            // happen given the single-hop fall-off contract) is just
            // recorded; the oneshot has already been consumed.
            let _ = tx.send(());
        }
    }
}

/// Mock A-server bound on a random port. The wildcard `:agent_id`
/// path-segment is intentional — we want this fixture to be robust
/// to whatever agent id format Phase 3 ends up using and to capture
/// every cross-agent POST regardless of the originator id the test
/// supplied.
async fn start_mock_a_server(
    captures: Arc<ReplyCaptures>,
) -> (String, tokio::task::JoinHandle<()>) {
    let app = Router::new().route(
        "/api/agents/:agent_id/events/stream",
        post(
            move |AxumPath(agent_id): AxumPath<String>,
                  headers: HeaderMap,
                  Json(body): Json<Value>| {
                let captures = Arc::clone(&captures);
                async move {
                    let depth_header = headers
                        .get("x-aura-cross-agent-depth")
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());
                    let bearer = headers
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.strip_prefix("Bearer ").map(str::to_string));
                    captures.record(CapturedReply {
                        method: Method::POST,
                        path: format!("/api/agents/{agent_id}/events/stream"),
                        depth_header,
                        bearer,
                        body,
                    });
                    // The originator-side cross-agent hook
                    // (`crates/aura-runtime/src/session/cross_agent_hook.rs`
                    // in aura-harness) gates on
                    // `x-aura-chat-persisted: true` before counting
                    // the deliver as durable. The Phase 3 callback
                    // doesn't read that header itself — but stamping
                    // it here keeps this fixture honest with the
                    // cross-repo contract so a future tightening of
                    // the originator-side check doesn't silently
                    // start dropping captures.
                    let mut response_headers = HeaderMap::new();
                    response_headers.insert("x-aura-chat-persisted", "true".parse().unwrap());
                    (StatusCode::OK, response_headers, "{}".to_string())
                }
            },
        ),
    );

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock A-server");
    let url = format!("http://{}", listener.local_addr().expect("local addr"));
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (url, handle)
}

// ---------------------------------------------------------------------------
// Mock billing — copy of the helper used by `chat_events_test/streaming.rs`,
// inlined so this file does not couple to that test module's private
// fn.
// ---------------------------------------------------------------------------

/// Mock aura-network that 404s every agent lookup. The chat
/// resolver maps a `404` from `client.get_agent` to
/// [`aura_os_agents::AgentError::NotFound`], which then falls back
/// to [`AgentService::get_agent_local`] — the shadow we save below
/// is what actually drives B's chat. Mirrors the same minimal mock
/// used by `chat_events_test/streaming.rs` so we don't have to
/// stand up the full org / project / member network surface.
async fn start_mock_network() -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        axum::routing::get(|| async {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not found" })),
            )
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

async fn start_mock_billing() -> String {
    let app = Router::new()
        .route(
            "/v1/accounts/me",
            axum::routing::get(|| async {
                Json(serde_json::json!({
                    "user_id": "u1",
                    "balance_cents": 999_999,
                    "balance_formatted": "$9,999.99",
                    "lifetime_purchased_cents": 1_000_000,
                    "lifetime_granted_cents": 0,
                    "lifetime_used_cents": 1,
                    "plan": "free",
                    "auto_refill_enabled": false,
                    "created_at": "2026-01-01T00:00:00Z"
                }))
            }),
        )
        .route(
            "/v1/credits/balance",
            axum::routing::get(|| async {
                Json(serde_json::json!({
                    "balance_cents": 999_999,
                    "plan": "free",
                    "balance_formatted": "$9,999.99"
                }))
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    url
}

// ---------------------------------------------------------------------------
// Test scaffolding — wires storage, billing, FakeHarness, agent
// shadow, project shadow, and the project_agent storage row.
// ---------------------------------------------------------------------------

/// Bundle of handles a single test scenario uses.
struct Scenario {
    app: Router,
    agent_b_id: AgentId,
    project_id: ProjectId,
    /// Held only so the storage `_db` mock task isn't dropped and
    /// the temp dir survives the test body. Dropping these would
    /// silently 5xx subsequent storage reads.
    _storage: Arc<StorageClient>,
    _store_dir: tempfile::TempDir,
    _fake_harness: Arc<FakeHarness>,
}

async fn build_phase7_scenario() -> Scenario {
    // 1. Mock storage with a project_agent row binding agent B to a
    //    project. `find_matching_project_agents` → fallback to local
    //    project → storage `list_project_agents` → match on agent
    //    id.
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    // Leak the in-memory DB handle so the mock storage process keeps
    // serving for the test duration; if `_db` were dropped the next
    // request would hit a closed channel.
    std::mem::forget(_db);
    let storage = Arc::new(StorageClient::with_base_url(&storage_url));

    // 2. Mock billing.
    let billing_url = start_mock_billing().await;
    let billing = Arc::new(aura_os_billing::BillingClient::with_base_url(billing_url));

    // 3. Mock aura-network. The chat resolver is no longer happy
    //    with `network_client = None` (it surfaces a generic 500
    //    "aura-network is not configured" instead of the specific
    //    `NotFound` arm that triggers the local-shadow fallback),
    //    so we wire a minimal 404-everywhere mock. The cascade
    //    then lands on `AgentService::get_agent_local` ⇒ the
    //    shadow we save below.
    let network_url = start_mock_network().await;
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&network_url));

    // 4. SettingsStore-backed app state. Reuses `build_test_app_from_store`
    //    so we get the validation_cache wiring + every Phase 5/6 field
    //    populated for free; we then patch `local_harness` on top.
    let store_dir = tempfile::tempdir().expect("temp dir");
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).expect("store"));
    store_zero_auth_session(&store);

    let (_router_with_real_harness, mut state) = build_test_app_from_store(
        store.clone(),
        store_dir.path().to_path_buf(),
        Some(network),
        Some(storage.clone()),
        None,
        Some(billing),
    );

    // 4. FakeHarness with the scripted text-delta + assistant-message-end
    //    we want B's "turn" to emit. Both `local_harness` and
    //    `swarm_harness` get the same fake so the test does not depend
    //    on whether agent B's `machine_type` selects local or swarm.
    let fake = Arc::new(FakeHarness::new());
    fake.set_script(vec![
        HarnessOutbound::TextDelta(TextDelta {
            text: "Hi there!".to_string(),
        }),
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        }),
    ])
    .await;
    let harness_link: Arc<dyn HarnessLink> = fake.clone();
    state.local_harness = harness_link.clone();
    state.swarm_harness = harness_link;

    // 5. Project shadow saved locally — `discovery::list_project_ids`
    //    falls back to `state.project_service.list_projects()` because
    //    `network_client` is `None` above.
    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Phase 7 Test Project".into(),
            description: "fixture project for cross-agent reply test".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create local project shadow");

    // 6. Storage project_agent row — required so
    //    `setup_agent_chat_persistence_with_matched` finds a match
    //    and produces a non-`None` `ChatPersistCtx`.
    let agent_b_id = AgentId::new();
    storage
        .create_project_agent(
            &project.project_id.to_string(),
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: agent_b_id.to_string(),
                name: "Agent B".into(),
                org_id: Some(project.org_id.to_string()),
                role: Some("Listener".into()),
                instance_role: None,
                source: None,
                personality: None,
                system_prompt: None,
                skills: Some(vec![]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project_agent row");

    // 7. Local agent shadow — `resolve_agent_for_chat` tries the
    //    network first (None ⇒ NotFound) and falls back to the
    //    shadow. `machine_type = "local"` selects the
    //    `local_harness` (FakeHarness) above.
    let agent = Agent {
        agent_id: agent_b_id,
        user_id: "u1".into(),
        org_id: Some(project.org_id),
        name: "Agent B".into(),
        role: "dev".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        // `local` keeps `require_credits_for_auth_source` honest
        // without needing a special bypass branch — see the doc on
        // `start_mock_billing` for why we still wire a real billing
        // mock.
        auth_source: "local".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        wallet_address: None,
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
    state
        .agent_service
        .save_agent_shadow(&agent)
        .expect("save shadow");

    let app = aura_os_server::create_router_with_interface(state.clone(), None);

    Scenario {
        app,
        agent_b_id,
        project_id: project.project_id,
        _storage: storage,
        _store_dir: store_dir,
        _fake_harness: fake,
    }
}

/// POST `/api/agents/<B>/events/stream` and discard the SSE body.
/// We don't care about the streamed events — the persist task is
/// the one that fires the cross-agent callback, and it runs on its
/// own tokio task.
async fn drive_chat_request(
    app: &Router,
    agent_b: &AgentId,
    body: Value,
    extra_headers: &[(&'static str, &'static str)],
) -> (StatusCode, String) {
    let mut builder = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/agents/{agent_b}/events/stream"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {TEST_JWT}"));
    for (name, value) in extra_headers {
        builder = builder.header(*name, *value);
    }
    let request = builder
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app
        .clone()
        .oneshot(request)
        .await
        .expect("oneshot response");
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), 16 * 1024)
        .await
        .map(|b| String::from_utf8_lossy(&b).to_string())
        .unwrap_or_default();
    (status, body)
}

// ---------------------------------------------------------------------------
// 1) Happy path: callback fires, depth header increments, body
//    `originating_agent_id` is null, content carries the reply.
// ---------------------------------------------------------------------------

/// **Load-bearing for Phase 3**: pins the cross-agent callback wire
/// contract end-to-end. A regression here would mean either the
/// persist task stopped firing the callback, or the callback body
/// lost a load-bearing field (`new_session=false`,
/// `originating_agent_id=null`), or the depth header stopped
/// incrementing. Each of those silently disables a different layer
/// of the cycle-protection / single-hop fall-off contract.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn cross_agent_reply_callback_fires_on_assistant_message_end() {
    let _lock = env_lock().lock().unwrap_or_else(|p| p.into_inner());

    let (notify_first_tx, notify_first_rx) = oneshot::channel();
    let captures = Arc::new(ReplyCaptures::new(notify_first_tx));
    let (mock_a_url, _server_handle) = start_mock_a_server(Arc::clone(&captures)).await;
    let _env = EnvGuard::set("AURA_SERVER_BASE_URL", &mock_a_url);

    let scenario = build_phase7_scenario().await;

    let (status, body) = drive_chat_request(
        &scenario.app,
        &scenario.agent_b_id,
        serde_json::json!({
            "content": "ping from A",
            "originating_agent_id": "agent-A",
            "project_id": scenario.project_id.to_string(),
            // A forwards its model on the inbound leg; the reply
            // callback must carry the same model back so A's
            // reply-triggered turn never opens with an empty model.
            "model": "aura-claude-sonnet-4-6",
        }),
        &[],
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "B-side stream must succeed before the persist task can fire the cross-agent callback; \
         body={body}",
    );

    // Wait at most 5 s for the fire-and-forget callback to land.
    // The persist task spawns the callback on
    // `AssistantMessageEnd`; the FakeHarness emits that event right
    // after the seeded `TextDelta`, so the wall-clock budget is
    // dominated by tokio scheduling + a single loopback HTTP round-trip.
    tokio::time::timeout(Duration::from_secs(5), notify_first_rx)
        .await
        .expect(
            "Phase 3 cross-agent callback did not fire within 5 s; \
             check `aura::cross_agent` debug logs and that \
             `AURA_SERVER_BASE_URL` was honored",
        )
        .expect("notify channel closed before capture");

    let snapshot = captures.snapshot();
    assert_eq!(
        snapshot.len(),
        1,
        "expected exactly one cross-agent callback POST, got {snapshot:?}"
    );
    let capture = &snapshot[0];

    assert_eq!(capture.method, Method::POST);
    assert_eq!(
        capture.path, "/api/agents/agent-A/events/stream",
        "callback must POST to /api/agents/<originating_agent_id>/events/stream"
    );
    assert_eq!(
        capture.depth_header.as_deref(),
        Some("1"),
        "depth must increment from 0 (test driver default) to 1 on the outbound callback"
    );
    let bearer = capture
        .bearer
        .as_deref()
        .expect("callback must propagate the inbound bearer token");
    assert!(
        !bearer.is_empty(),
        "bearer token must be non-empty (any specific JWT shape is unspecified)"
    );

    // Body assertions.
    let content = capture
        .body
        .get("content")
        .and_then(Value::as_str)
        .expect("callback body must include `content`");
    assert!(
        content.contains("Hi there!"),
        "callback content must carry B's reply text; got {content:?}"
    );
    assert!(
        capture.body.get("originating_agent_id").is_some(),
        "callback body must include `originating_agent_id` field"
    );
    assert!(
        capture.body["originating_agent_id"].is_null(),
        "single-hop fall-off: callback body's `originating_agent_id` must be JSON null \
         (the receiving agent has no upstream to bounce back to). got {:?}",
        capture.body["originating_agent_id"]
    );
    assert_eq!(
        capture.body.get("project_id").and_then(Value::as_str),
        Some(scenario.project_id.to_string().as_str()),
        "the reply must return to the same project conversation"
    );
    // Display-side cross-agent provenance: the callback body MUST
    // carry `from_agent_id: <Barret's org-level agent_id>` so A's
    // chat panel can label the inbound row "↩ from <Barret>"
    // instead of letting the reply masquerade as a duplicate of
    // A's original prompt — that mislabeling is exactly the UX
    // bug the field was added to fix. Distinct from the routing
    // field above: `originating_agent_id` is intentionally null
    // here, but `from_agent_id` carries Barret's identity for
    // display purposes only.
    assert!(
        capture.body.get("from_agent_id").is_some(),
        "callback body must include `from_agent_id` field so A's chat panel \
         can render the cross-agent provenance badge"
    );
    let from_agent_id = capture
        .body
        .get("from_agent_id")
        .and_then(Value::as_str)
        .expect("from_agent_id must serialize as a non-null string when set");
    assert!(
        !from_agent_id.is_empty(),
        "from_agent_id must be a non-empty agent UUID; got {from_agent_id:?}"
    );
    assert_eq!(
        capture.body.get("new_session").and_then(Value::as_bool),
        Some(false),
        "callback must reuse A's chat session, not open a new one"
    );
    // The reply leg must carry the model B's turn ran on (which is
    // the model A forwarded on the inbound leg) so A's
    // reply-triggered turn runs on a real model instead of failing
    // with "model name must not be empty".
    assert_eq!(
        capture.body.get("model").and_then(Value::as_str),
        Some("aura-claude-sonnet-4-6"),
        "callback body must carry the turn's model back into A's session; got {:?}",
        capture.body.get("model")
    );
}

// ---------------------------------------------------------------------------
// 2) Negative: no `originating_agent_id` ⇒ no callback.
// ---------------------------------------------------------------------------

/// **Load-bearing for Phase 2**: pins the contract that a regular
/// user-typed chat turn (no upstream agent sender) does NOT
/// surreptitiously fan out a cross-agent POST. Regression here
/// would mean the chat handler accidentally treated every turn as
/// cross-agent and the originating-side panel would start receiving
/// duplicate copies of every assistant reply.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn cross_agent_callback_skipped_when_originating_agent_id_missing() {
    let _lock = env_lock().lock().unwrap_or_else(|p| p.into_inner());

    let (notify_first_tx, _notify_first_rx) = oneshot::channel();
    let captures = Arc::new(ReplyCaptures::new(notify_first_tx));
    let (mock_a_url, _server_handle) = start_mock_a_server(Arc::clone(&captures)).await;
    let _env = EnvGuard::set("AURA_SERVER_BASE_URL", &mock_a_url);

    let scenario = build_phase7_scenario().await;

    let (status, body) = drive_chat_request(
        &scenario.app,
        &scenario.agent_b_id,
        serde_json::json!({ "content": "regular user turn" }),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={body}");

    // The callback (if it were to fire) is a fire-and-forget
    // `tokio::spawn`. Wait long enough that any racing spawn would
    // have completed its loopback POST. 1 s is generous for an
    // in-process loopback HTTP round-trip.
    tokio::time::sleep(Duration::from_secs(1)).await;

    let snapshot = captures.snapshot();
    assert!(
        snapshot.is_empty(),
        "no `originating_agent_id` means no cross-agent reply, got {snapshot:?}"
    );
}

// ---------------------------------------------------------------------------
// 3) Negative: inbound depth at the cap ⇒ no callback (cycle guard).
// ---------------------------------------------------------------------------

/// **Load-bearing for Phase 3**: pins the
/// `MAX_CROSS_AGENT_REPLY_DEPTH = 4` cycle guard. Two agents
/// passing replies back and forth is bounded by the depth header
/// alone (the body's `originating_agent_id: null` is the primary
/// fall-off; this counter is the belt-and-suspenders second line).
/// Regression here would mean the depth check stopped reading the
/// inbound header or stopped comparing it against the cap, and the
/// loop fence collapses to whatever the harness's tool-loop budget
/// happens to be.
///
/// We don't try to assert the `aura::cross_agent`
/// `"cross-agent reply suppressed: depth budget exhausted"` `warn!`
/// fired — building a tracing-subscriber capture in this file just
/// for that one log line would be heavier than the assertion is
/// worth, and the unit test
/// `cross_agent_reply_depth_guard_stops_chain` in
/// `cross_agent_reply.rs` already pins the predicate at the level
/// of its pure inputs. The *behavioural* contract we DO need to pin
/// at this seam is "no HTTP callback fires", which is exactly what
/// the captures assertion below verifies.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn cross_agent_callback_skipped_at_max_depth() {
    let _lock = env_lock().lock().unwrap_or_else(|p| p.into_inner());

    let (notify_first_tx, _notify_first_rx) = oneshot::channel();
    let captures = Arc::new(ReplyCaptures::new(notify_first_tx));
    let (mock_a_url, _server_handle) = start_mock_a_server(Arc::clone(&captures)).await;
    let _env = EnvGuard::set("AURA_SERVER_BASE_URL", &mock_a_url);

    let scenario = build_phase7_scenario().await;

    let (status, body) = drive_chat_request(
        &scenario.app,
        &scenario.agent_b_id,
        serde_json::json!({
            "content": "depth-capped turn",
            "originating_agent_id": "agent-A",
        }),
        // Phase 3: `MAX_CROSS_AGENT_REPLY_DEPTH` = 4. Inbound
        // requests at-or-above the cap must short-circuit before
        // the callback spawns. Sending exactly `4` lands us on the
        // boundary (the predicate is `depth >= MAX`, so 4 is the
        // refuse arm).
        &[("x-aura-cross-agent-depth", "4")],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={body}");

    tokio::time::sleep(Duration::from_secs(1)).await;

    let snapshot = captures.snapshot();
    assert!(
        snapshot.is_empty(),
        "callback must NOT fire when inbound `X-Aura-Cross-Agent-Depth` is at the \
         MAX_CROSS_AGENT_REPLY_DEPTH cap, got {snapshot:?}"
    );
}
