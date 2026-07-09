use super::cache::{get_cached_session, get_stale_cached_session};
use super::*;
use aura_os_core::{JwtProvider, ZeroAuthSession};
use chrono::Utc;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Instant;
use tower::ServiceExt;

fn test_runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("failed to build test runtime")
    })
}

fn make_session(is_zero_pro: bool, validated_at: chrono::DateTime<Utc>) -> ZeroAuthSession {
    ZeroAuthSession {
        user_id: "u1".into(),
        network_user_id: None,
        profile_id: None,
        display_name: "Test User".into(),
        profile_image: String::new(),
        primary_zid: "0://tester".into(),
        zero_wallet: "0xabc".into(),
        wallets: vec![],
        access_token: "test-jwt-token".into(),
        is_zero_pro,
        is_access_granted: false,
        is_sys_admin: false,
        created_at: validated_at,
        validated_at,
    }
}

// --- Token extraction tests ---

fn request_with_auth_header(value: &str) -> Request {
    axum::http::Request::builder()
        .header("Authorization", value)
        .body(axum::body::Body::empty())
        .unwrap()
}

fn request_with_query(query: &str) -> Request {
    axum::http::Request::builder()
        .uri(format!("/api/test?{query}"))
        .body(axum::body::Body::empty())
        .unwrap()
}

fn request_bare() -> Request {
    axum::http::Request::builder()
        .body(axum::body::Body::empty())
        .unwrap()
}

#[test]
fn extract_token_from_bearer_header() {
    let req = request_with_auth_header("Bearer my-jwt-token");
    assert_eq!(extract_request_token(&req).unwrap(), "my-jwt-token");
}

#[test]
fn extract_token_missing_bearer_prefix() {
    let req = request_with_auth_header("Basic abc123");
    assert!(extract_request_token(&req).is_none());
}

#[test]
fn extract_token_ignores_raw_jwt_query_param() {
    // Raw `?token=<jwt>` is no longer accepted: long-lived tokens must
    // never travel in a URL (they leak into proxy/access logs).
    let req = request_with_query("token=ws-jwt-token");
    assert!(extract_request_token(&req).is_none());
}

#[test]
fn extract_ws_ticket_from_query_param() {
    let req = request_with_query("ticket=abc123");
    assert_eq!(extract_ws_ticket(&req).unwrap(), "abc123");
}

#[test]
fn extract_ws_ticket_from_query_with_other_params() {
    let req = request_with_query("foo=bar&ticket=tok&since=9");
    assert_eq!(extract_ws_ticket(&req).unwrap(), "tok");
}

#[test]
fn extract_token_prefers_header_over_query() {
    let req = axum::http::Request::builder()
        .uri("/api/test?ticket=query-ticket")
        .header("Authorization", "Bearer header-token")
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(extract_request_token(&req).unwrap(), "header-token");
}

#[test]
fn extract_token_returns_none_when_absent() {
    let req = request_bare();
    assert!(extract_request_token(&req).is_none());
    assert!(extract_ws_ticket(&req).is_none());
}

#[test]
fn redeem_ws_ticket_is_single_use() {
    let store: crate::state::WsTicketStore = Arc::new(dashmap::DashMap::new());
    store.insert(
        "tok".to_string(),
        crate::state::WsTicketEntry {
            jwt: "bound-jwt".to_string(),
            created_at: Instant::now(),
        },
    );
    // First redeem returns the bound JWT and burns the ticket.
    assert_eq!(redeem_ws_ticket(&store, "tok").unwrap(), "bound-jwt");
    // Second redeem of the same ticket fails (single-use).
    assert!(redeem_ws_ticket(&store, "tok").is_none());
}

#[test]
fn redeem_ws_ticket_rejects_expired() {
    let store: crate::state::WsTicketStore = Arc::new(dashmap::DashMap::new());
    let stale = Instant::now() - (crate::state::WS_TICKET_TTL + std::time::Duration::from_secs(1));
    store.insert(
        "old".to_string(),
        crate::state::WsTicketEntry {
            jwt: "bound-jwt".to_string(),
            created_at: stale,
        },
    );
    assert!(redeem_ws_ticket(&store, "old").is_none());
}

#[test]
fn redeem_ws_ticket_rejects_unknown() {
    let store: crate::state::WsTicketStore = Arc::new(dashmap::DashMap::new());
    assert!(redeem_ws_ticket(&store, "nope").is_none());
}

#[test]
fn extract_token_empty_bearer_value() {
    let req = request_with_auth_header("Bearer ");
    // "Bearer " with trailing space -- strip_prefix("Bearer ") returns ""
    assert_eq!(extract_request_token(&req).unwrap(), "");
}

// --- Client IP extraction tests (Mixpanel geolocation) ---

fn headers_with(pairs: &[(&str, &str)]) -> axum::http::HeaderMap {
    let mut headers = axum::http::HeaderMap::new();
    for (name, value) in pairs {
        headers.insert(
            axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            axum::http::HeaderValue::from_str(value).unwrap(),
        );
    }
    headers
}

#[test]
fn client_ip_prefers_first_forwarded_hop() {
    let headers = headers_with(&[("x-forwarded-for", "203.0.113.7, 10.0.0.1")]);
    assert_eq!(
        client_ip_from_headers(&headers),
        Some("203.0.113.7".to_string())
    );
}

#[test]
fn client_ip_falls_back_to_real_ip() {
    let headers = headers_with(&[("x-real-ip", "198.51.100.42")]);
    assert_eq!(
        client_ip_from_headers(&headers),
        Some("198.51.100.42".to_string())
    );
}

#[test]
fn client_ip_drops_loopback_and_missing() {
    assert_eq!(
        client_ip_from_headers(&headers_with(&[("x-forwarded-for", "127.0.0.1")])),
        None
    );
    assert_eq!(client_ip_from_headers(&axum::http::HeaderMap::new()), None);
}

// --- Validation cache tests ---

fn make_cache() -> crate::state::ValidationCache {
    Arc::new(dashmap::DashMap::new())
}

fn insert_cached(cache: &crate::state::ValidationCache, jwt: &str, age: std::time::Duration) {
    cache.insert(
        jwt.to_string(),
        CachedSession {
            session: make_session(true, Utc::now()),
            validated_at: Instant::now() - age,
            zero_pro_refresh_error: None,
        },
    );
}

#[test]
fn get_cached_session_returns_fresh_entry() {
    let cache = make_cache();
    insert_cached(&cache, "jwt-1", std::time::Duration::from_secs(60));

    let state = mock_app_state_with_cache(cache);
    let result = get_cached_session(&state, "jwt-1");
    assert!(result.is_some());
    assert_eq!(result.unwrap().0.user_id, "u1");
}

#[test]
fn get_cached_session_returns_none_for_stale_entry() {
    let cache = make_cache();
    insert_cached(&cache, "jwt-1", std::time::Duration::from_secs(6 * 60));

    let state = mock_app_state_with_cache(cache);
    assert!(get_cached_session(&state, "jwt-1").is_none());
}

#[test]
fn get_cached_session_returns_none_for_missing_entry() {
    let cache = make_cache();
    let state = mock_app_state_with_cache(cache);
    assert!(get_cached_session(&state, "nonexistent").is_none());
}

#[test]
fn get_stale_cached_session_allows_entries_within_hard_cap() {
    let cache = make_cache();
    insert_cached(&cache, "jwt-1", std::time::Duration::from_secs(20 * 60));

    let state = mock_app_state_with_cache(cache);
    let result = get_stale_cached_session(&state, "jwt-1");

    assert!(result.is_some());
    assert_eq!(result.unwrap().0.user_id, "u1");
}

#[test]
fn get_stale_cached_session_rejects_entries_beyond_hard_cap() {
    let cache = make_cache();
    insert_cached(&cache, "jwt-1", std::time::Duration::from_secs(31 * 60));

    let state = mock_app_state_with_cache(cache);

    assert!(get_stale_cached_session(&state, "jwt-1").is_none());
}

#[test]
fn sensitive_auth_path_marks_billing_and_secret_routes() {
    assert!(is_sensitive_auth_path(
        &Method::GET,
        "/api/orgs/org-1/credits/balance"
    ));
    assert!(is_sensitive_auth_path(
        &Method::PUT,
        "/api/orgs/org-1/integration-config"
    ));
    assert!(is_sensitive_auth_path(
        &Method::PUT,
        "/api/orgs/org-1/integrations/int-1/secret"
    ));
}

#[test]
fn sensitive_auth_path_marks_mutating_org_tool_routes_only() {
    assert!(is_sensitive_auth_path(
        &Method::POST,
        "/api/orgs/org-1/tool-actions/mcp/int-1"
    ));
    assert!(!is_sensitive_auth_path(
        &Method::GET,
        "/api/orgs/org-1/tool-actions"
    ));
}

#[tokio::test]
async fn require_verified_session_persists_session_for_store_backed_services() {
    let cache = make_cache();
    let state = mock_app_state_with_cache(cache);
    let mut session = make_session(true, Utc::now());
    session.access_token = "persist-jwt".into();
    state.validation_cache.insert(
        "persist-jwt".into(),
        CachedSession {
            session,
            validated_at: Instant::now(),
            zero_pro_refresh_error: None,
        },
    );

    let app = axum::Router::new()
        .route(
            "/probe",
            axum::routing::get(|| async { StatusCode::NO_CONTENT }),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_verified_session,
        ))
        .with_state(state.clone());

    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/probe")
                .header("Authorization", "Bearer persist-jwt")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(state.store.get_jwt().as_deref(), Some("persist-jwt"));
}

// --- Pro enforcement tests ---

#[test]
fn enforce_zero_pro_allows_pro_user() {
    let state = mock_app_state_pro_required(true);
    let session = make_session(true, Utc::now());
    assert!(enforce_zero_pro(&state, &session).is_ok());
}

#[test]
fn enforce_zero_pro_rejects_non_pro_user() {
    let state = mock_app_state_pro_required(true);
    let session = make_session(false, Utc::now());
    let err = enforce_zero_pro(&state, &session).unwrap_err();
    assert_eq!(err.0, StatusCode::FORBIDDEN);
}

#[test]
fn enforce_zero_pro_allows_non_pro_when_not_required() {
    let state = mock_app_state_pro_required(false);
    let session = make_session(false, Utc::now());
    assert!(enforce_zero_pro(&state, &session).is_ok());
}

// --- Helpers to build minimal AppState for unit tests ---

fn mock_app_state_with_cache(cache: crate::state::ValidationCache) -> AppState {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let _rt_guard = test_runtime().enter();
    let store = Arc::new(
        aura_os_store::SettingsStore::open(
            &std::env::temp_dir().join(format!("aura-test-guard-{}-{id}", std::process::id())),
        )
        .unwrap(),
    );
    let (event_broadcast, _) = tokio::sync::broadcast::channel(16);
    let event_hub = aura_os_events::EventHub::new();
    let loop_registry = aura_os_loops::LoopRegistry::new(event_hub.clone());
    let router_url = "http://localhost:9998".to_string();
    let agent_event_listener = Arc::new(crate::agent_events::AgentEventListener::new(100));
    agent_event_listener.spawn(event_broadcast.subscribe());

    AppState {
        data_dir: std::env::temp_dir(),
        store: store.clone(),
        org_service: Arc::new(aura_os_orgs::OrgService::new(store.clone())),
        auth_service: Arc::new(aura_os_auth::AuthService::new()),
        billing_client: Arc::new(aura_os_billing::BillingClient::new()),
        web_search_rate_limiter: crate::tool_action_rate_limit::ToolActionRateLimiter::default(),
        project_service: Arc::new(aura_os_projects::ProjectService::new(store.clone())),
        task_service: Arc::new(aura_os_tasks::TaskService::new(store.clone(), None)),
        agent_service: Arc::new(aura_os_agents::AgentService::new(store.clone(), None)),
        agent_instance_service: Arc::new(aura_os_agents::AgentInstanceService::new(
            store.clone(),
            None,
            Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            None,
        )),
        session_service: Arc::new(aura_os_sessions::SessionService::new(
            store.clone(),
            0.8,
            200_000,
        )),
        local_harness: Arc::new(aura_os_harness::LocalHarness::from_env()),
        swarm_harness: Arc::new(aura_os_harness::SwarmHarness::from_env()),
        terminal_manager: Arc::new(aura_os_terminal::TerminalManager::new()),
        browser_manager: Arc::new(aura_os_browser::BrowserManager::new(
            aura_os_browser::BrowserConfig::default(),
        )),
        network_client: None,
        feedback_network_client: None,
        storage_client: None,
        integrations_client: None,
        event_log: crate::event_log::EventLog::with_bridge(
            event_broadcast.subscribe(),
            crate::event_log::EventLog::capacity_from_env(),
        ),
        live_streams: crate::live_streams::LiveStreamRegistry::from_env(),
        event_broadcast,
        event_hub,
        loop_registry,
        require_zero_pro: false,
        remote_only: false,
        chat_sessions: Arc::new(dashmap::DashMap::new()),
        credit_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        harness_http: Arc::new(crate::HarnessHttpGateway::new("http://localhost:9999")),
        automaton_registry: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        swarm_base_url: None,
        task_output_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        orbit_client: None,
        orbit_capacity_guard: std::sync::Arc::new(crate::orbit_guard::OrbitCapacityGuard::new()),
        validation_cache: cache,
        ws_ticket_store: Arc::new(dashmap::DashMap::new()),
        agent_discovery_cache: Arc::new(dashmap::DashMap::new()),
        router_url,
        http_client: reqwest::Client::new(),
        agent_event_listener,
        loop_log: Arc::new(crate::loop_log::LoopLogWriter::new(
            std::env::temp_dir().join(format!("aura-test-loop-{}-{id}", std::process::id())),
        )),
        harness_ws_slots: 128,
        turn_first_event_timeout: std::time::Duration::from_secs(120),
        turn_max_idle_timeout: std::time::Duration::from_secs(1800),
        chat_auto_fork_threshold: 0.80,
        stability_metrics: Arc::new(crate::stability_metrics::StabilityMetrics::new()),
        started_at: std::time::Instant::now(),
        harness_broadcast_capacity: 16384,
        public_rate_limiter: crate::handlers::public::RateLimiter::new(),
        public_demo_agent_id: Arc::new(tokio::sync::OnceCell::new()),
        mixpanel: None,
        channel_service: Arc::new(aura_os_channels::ChannelService::new(store.clone())),
        telegram_bot_username: Arc::new(tokio::sync::OnceCell::new()),
    }
}

fn mock_app_state_pro_required(require_pro: bool) -> AppState {
    let mut state = mock_app_state_with_cache(make_cache());
    state.require_zero_pro = require_pro;
    state
}
