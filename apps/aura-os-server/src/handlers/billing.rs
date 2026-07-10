use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{BillingAccount, CreditBalance, OrgId, TransactionsResponse};

use crate::capture_auth::is_capture_access_token;
use crate::dto::CreateCreditCheckoutRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

fn billing_err(e: aura_os_billing::BillingError) -> (StatusCode, Json<ApiError>) {
    match e {
        aura_os_billing::BillingError::InsufficientCredits { balance_cents } => {
            ApiError::payment_required(format!(
                "Insufficient credits (balance: {balance_cents} cents). Please purchase credits to continue."
            ))
        }
        aura_os_billing::BillingError::AccountNotFound { body } => (
            StatusCode::BAD_GATEWAY,
            Json(ApiError {
                error: "billing account not provisioned".to_string(),
                code: "billing_account_missing".to_string(),
                details: Some(body),
                data: None,
            }),
        ),
        aura_os_billing::BillingError::AccountProvisioningFailed { status, body } => (
            StatusCode::BAD_GATEWAY,
            Json(ApiError {
                error: "unable to provision billing account".to_string(),
                code: "billing_account_provisioning_failed".to_string(),
                details: Some(format!("status={status} body={body}")),
                data: None,
            }),
        ),
        aura_os_billing::BillingError::ServerError { status, body } => {
            let (sc, code, msg) = match status {
                401 => (StatusCode::UNAUTHORIZED, "unauthorized", "billing token expired or invalid"),
                403 => (StatusCode::FORBIDDEN, "forbidden", "billing server rejected the request"),
                404 => (StatusCode::BAD_GATEWAY, "billing_account_missing", "billing account not provisioned"),
                _ => (StatusCode::BAD_GATEWAY, "billing_error", "billing server error"),
            };
            (sc, Json(ApiError { error: msg.to_string(), code: code.to_string(), details: Some(body), data: None }))
        }
        aura_os_billing::BillingError::Request(_) => {
            (StatusCode::BAD_GATEWAY, Json(ApiError {
                error: "unable to reach billing server".to_string(),
                code: "billing_unreachable".to_string(),
                details: Some(e.to_string()),
                data: None,
            }))
        }
        _ => ApiError::internal(format!("billing operation failed: {e}")),
    }
}

/// Whether a billing failure is worth retrying. Transport-level errors
/// (connect/timeout) and 5xx responses are transient; definitive answers —
/// insufficient credits, auth/account errors — are returned without retry.
fn is_transient_billing_error(err: &aura_os_billing::BillingError) -> bool {
    use aura_os_billing::BillingError;
    matches!(
        err,
        BillingError::Request(_)
            | BillingError::ServerError {
                status: 500..=599,
                ..
            }
    )
}

/// Pre-flight check: ensures the authenticated user has a positive credit balance.
///
/// Results are cached for 60 seconds when credits are available to avoid
/// hitting the billing API on every chat message.
pub(crate) async fn require_credits(
    state: &AppState,
    jwt: &str,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    use crate::state::CreditCache;
    use std::time::{Duration, Instant};

    const CACHE_TTL: Duration = Duration::from_secs(60);
    // Short backoffs applied only to transient billing failures (transport
    // blips / 5xx). The happy path and definitive answers never sleep.
    const RETRY_BACKOFFS: [Duration; 2] = [Duration::from_millis(100), Duration::from_millis(250)];

    {
        let mut cache = state.credit_cache.lock().await;
        cache.retain(|_, c| c.last_check.elapsed() < CACHE_TTL);
        if let Some(c) = cache.get(jwt) {
            if c.has_credits && c.last_check.elapsed() < CACHE_TTL {
                return Ok(());
            }
        }
    }

    // A single dropped connection or a billing-server cold start shouldn't fail
    // the user's turn outright. Retry transient failures (transport errors and
    // 5xx) with a short backoff; definitive answers (insufficient credits,
    // auth/account errors) are returned immediately without retry.
    let mut result = state.billing_client.ensure_has_credits(jwt).await;
    for backoff in RETRY_BACKOFFS {
        if !matches!(&result, Err(e) if is_transient_billing_error(e)) {
            break;
        }
        tokio::time::sleep(backoff).await;
        result = state.billing_client.ensure_has_credits(jwt).await;
    }

    // Only a positive result is cached — that's the hot path that skips the
    // billing round-trip for 60s. Failures are never cached: a transient blip
    // must not linger, and the cache is only ever read as a positive
    // "has credits" short-circuit, so a cached negative would be dead weight.
    if result.is_ok() {
        let mut cache = state.credit_cache.lock().await;
        cache.insert(
            jwt.to_string(),
            CreditCache {
                last_check: Instant::now(),
                has_credits: true,
            },
        );
    }

    result.map_err(billing_err)?;
    Ok(())
}

pub(crate) async fn require_credits_for_auth_source(
    state: &AppState,
    jwt: &str,
    _auth_source: &str,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    require_credits(state, jwt).await
}

pub(crate) async fn get_credit_balance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<serde_json::Value>> {
    if is_capture_access_token(&jwt) {
        let balance = CreditBalance {
            balance_cents: 50_000,
            plan: "Capture Demo".into(),
            balance_formatted: "$500.00".into(),
        };
        return Ok(Json(serde_json::to_value(balance).unwrap_or_default()));
    }

    let balance = state
        .billing_client
        .get_balance(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(serde_json::to_value(balance).unwrap_or_default()))
}

pub(crate) async fn create_credit_checkout(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
    Json(body): Json<CreateCreditCheckoutRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let resp = state
        .billing_client
        .create_purchase(&jwt, body.amount_usd)
        .await
        .map_err(billing_err)?;
    Ok(Json(serde_json::to_value(resp).unwrap_or_default()))
}

pub(crate) async fn get_transactions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<TransactionsResponse>> {
    let result = state
        .billing_client
        .get_transactions(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(result))
}

pub(crate) async fn get_account(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<BillingAccount>> {
    let result = state
        .billing_client
        .get_account(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(result))
}

// ============================================================================
// Subscriptions
// ============================================================================

pub(crate) async fn subscription_checkout(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    let plan = body
        .get("plan")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::bad_request("plan is required"))?;

    let resp = state
        .billing_client
        .create_subscription_checkout(&jwt, plan)
        .await
        .map_err(billing_err)?;
    Ok(Json(resp))
}

pub(crate) async fn subscription_portal(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<serde_json::Value>> {
    let resp = state
        .billing_client
        .create_portal_session(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(resp))
}

pub(crate) async fn subscription_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<aura_os_billing::SubscriptionStatus>> {
    let resp = state
        .billing_client
        .get_subscription_status(&jwt)
        .await
        .map_err(billing_err)?;
    Ok(Json(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    use axum::{
        extract::State as AxumState,
        http::{HeaderMap, StatusCode as HttpStatusCode},
        response::IntoResponse,
        routing::get,
        Json, Router,
    };
    use tokio::net::TcpListener;
    use tokio::sync::{broadcast, Mutex};

    use aura_os_agents::{AgentInstanceService, AgentService};
    use aura_os_auth::AuthService;
    use aura_os_billing::BillingClient;
    use aura_os_harness::{HarnessLink, LocalHarness, SwarmHarness};
    use aura_os_orgs::OrgService;
    use aura_os_projects::ProjectService;
    use aura_os_sessions::SessionService;
    use aura_os_store::SettingsStore;
    use aura_os_tasks::TaskService;

    use crate::HarnessHttpGateway;

    #[derive(Default)]
    struct MockBillingState {
        balance_calls: HashMap<String, usize>,
        /// When > 0, the next `get_balance` call returns a 503 and decrements
        /// this — lets tests simulate transient billing failures.
        fail_balance_remaining: usize,
    }

    fn bearer_token(headers: &HeaderMap) -> String {
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or_default()
            .to_string()
    }

    async fn start_credit_server() -> (String, Arc<Mutex<MockBillingState>>) {
        type SharedState = Arc<Mutex<MockBillingState>>;

        async fn get_account(headers: HeaderMap) -> axum::response::Response {
            let token = bearer_token(&headers);
            Json(serde_json::json!({
                "user_id": token,
                "balance_cents": 5000,
                "balance_formatted": "$50.00",
                "lifetime_purchased_cents": 5000,
                "lifetime_granted_cents": 0,
                "lifetime_used_cents": 0,
                "plan": "free",
                "auto_refill_enabled": false,
                "created_at": "2026-01-15T12:00:00Z"
            }))
            .into_response()
        }

        async fn get_balance(
            headers: HeaderMap,
            AxumState(state): AxumState<SharedState>,
        ) -> axum::response::Response {
            let token = bearer_token(&headers);
            let mut guard = state.lock().await;
            *guard.balance_calls.entry(token.clone()).or_default() += 1;
            if guard.fail_balance_remaining > 0 {
                guard.fail_balance_remaining -= 1;
                return (
                    HttpStatusCode::SERVICE_UNAVAILABLE,
                    "billing temporarily unavailable",
                )
                    .into_response();
            }
            let balance_cents = if token == "tok-a" { 5000 } else { 0 };
            Json(serde_json::json!({
                "balance_cents": balance_cents,
                "plan": "free",
                "balance_formatted": format!("${:.2}", balance_cents as f64 / 100.0)
            }))
            .into_response()
        }

        let state = Arc::new(Mutex::new(MockBillingState::default()));
        let app = Router::new()
            .route("/v1/accounts/me", get(get_account))
            .route("/v1/credits/balance", get(get_balance))
            .with_state(state.clone());

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.ok() });
        (url, state)
    }

    fn build_test_state(billing_client: Arc<BillingClient>) -> (AppState, tempfile::TempDir) {
        let store_dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());

        let org_service = Arc::new(OrgService::new(store.clone()));
        let auth_service = Arc::new(AuthService::new());
        let project_service = Arc::new(ProjectService::new_with_network(None, store.clone()));
        let task_service = Arc::new(TaskService::new(store.clone(), None));
        let agent_service = Arc::new(AgentService::new(store.clone(), None));
        let runtime_agent_state: aura_os_agents::RuntimeAgentStateMap =
            Arc::new(Mutex::new(HashMap::new()));
        let agent_instance_service = Arc::new(AgentInstanceService::new(
            store.clone(),
            None,
            runtime_agent_state,
            None,
        ));
        let session_service = Arc::new(SessionService::new(store.clone(), 0.8, 200_000));
        let harness_base = "http://localhost:19080".to_string();
        let local_harness: Arc<dyn HarnessLink> = Arc::new(LocalHarness::new(harness_base.clone()));
        let swarm_harness: Arc<dyn HarnessLink> = Arc::new(SwarmHarness::new(
            "http://localhost:19800".to_string(),
            None,
        ));
        let (event_broadcast, _) = broadcast::channel::<serde_json::Value>(64);
        let event_hub = aura_os_events::EventHub::new();
        let loop_registry = aura_os_loops::LoopRegistry::new(event_hub.clone());
        let harness_http = Arc::new(HarnessHttpGateway::new(harness_base.clone()));
        let router_url = "http://localhost:19080".to_string();
        let agent_event_listener = Arc::new(crate::agent_events::AgentEventListener::new(100));
        agent_event_listener.spawn(event_broadcast.subscribe());
        let channel_service = Arc::new(aura_os_channels::ChannelService::new(store.clone()));

        (
            AppState {
                data_dir: store_dir.path().to_path_buf(),
                store,
                org_service,
                auth_service,
                billing_client,
                web_search_rate_limiter:
                    crate::tool_action_rate_limit::WebSearchRateLimiter::default(),
                project_service,
                task_service,
                agent_service,
                agent_instance_service,
                session_service,
                local_harness,
                swarm_harness,
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
                credit_cache: Arc::new(Mutex::new(HashMap::new())),
                harness_http,
                automaton_registry: Arc::new(Mutex::new(HashMap::new())),
                swarm_base_url: None,
                task_output_cache: Arc::new(Mutex::new(HashMap::new())),
                orbit_client: None,
                orbit_capacity_guard: Arc::new(crate::orbit_guard::OrbitCapacityGuard::new()),
                validation_cache: Arc::new(dashmap::DashMap::new()),
                ws_ticket_store: Arc::new(dashmap::DashMap::new()),
                agent_discovery_cache: Arc::new(dashmap::DashMap::new()),
                router_url,
                http_client: reqwest::Client::new(),
                agent_event_listener,
                loop_log: Arc::new(crate::loop_log::LoopLogWriter::new(
                    store_dir.path().join("loop_logs"),
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
                channel_service,
                telegram_bot_username: Arc::new(tokio::sync::OnceCell::new()),
            },
            store_dir,
        )
    }

    #[tokio::test]
    async fn require_credits_caches_per_jwt() {
        let (billing_url, billing_state) = start_credit_server().await;
        let billing_client = Arc::new(BillingClient::with_base_url(billing_url));
        let (state, _store_dir) = build_test_state(billing_client);

        require_credits(&state, "tok-a").await.unwrap();

        let err = require_credits(&state, "tok-b").await.unwrap_err();
        assert_eq!(err.0, HttpStatusCode::PAYMENT_REQUIRED);

        require_credits(&state, "tok-a").await.unwrap();

        let guard = billing_state.lock().await;
        assert_eq!(guard.balance_calls.get("tok-a"), Some(&1));
        assert_eq!(guard.balance_calls.get("tok-b"), Some(&1));
    }

    #[tokio::test]
    async fn require_credits_retries_transient_billing_failure() {
        let (billing_url, billing_state) = start_credit_server().await;
        // Fail the balance check twice, then succeed — within the retry budget.
        billing_state.lock().await.fail_balance_remaining = 2;
        let billing_client = Arc::new(BillingClient::with_base_url(billing_url));
        let (state, _store_dir) = build_test_state(billing_client);

        // tok-a has credits; the two transient 503s should be absorbed by retry.
        require_credits(&state, "tok-a").await.unwrap();

        // 2 failed attempts + 1 success = 3 balance calls.
        assert_eq!(
            billing_state.lock().await.balance_calls.get("tok-a"),
            Some(&3)
        );
    }

    #[tokio::test]
    async fn require_credits_surfaces_error_after_exhausting_retries_without_caching_it() {
        let (billing_url, billing_state) = start_credit_server().await;
        // More failures than the retry budget (1 initial + 2 retries = 3).
        billing_state.lock().await.fail_balance_remaining = 5;
        let billing_client = Arc::new(BillingClient::with_base_url(billing_url));
        let (state, _store_dir) = build_test_state(billing_client);

        // All 3 attempts fail → a 502 is surfaced, not silently swallowed.
        let err = require_credits(&state, "tok-a").await.unwrap_err();
        assert_eq!(err.0, HttpStatusCode::BAD_GATEWAY);
        assert_eq!(
            billing_state.lock().await.balance_calls.get("tok-a"),
            Some(&3)
        );

        // The transient failure must NOT be cached as a denial: once billing
        // recovers, the very next call succeeds with no lingering negative.
        billing_state.lock().await.fail_balance_remaining = 0;
        require_credits(&state, "tok-a").await.unwrap();
    }

    #[tokio::test]
    async fn require_credits_does_not_retry_insufficient_credits() {
        let (billing_url, billing_state) = start_credit_server().await;
        let billing_client = Arc::new(BillingClient::with_base_url(billing_url));
        let (state, _store_dir) = build_test_state(billing_client);

        // tok-b has a zero balance → a definitive InsufficientCredits answer.
        let err = require_credits(&state, "tok-b").await.unwrap_err();
        assert_eq!(err.0, HttpStatusCode::PAYMENT_REQUIRED);

        // Exactly one balance call — a definitive answer is never retried, so
        // broke users don't pay a latency penalty on every message.
        assert_eq!(
            billing_state.lock().await.balance_calls.get("tok-b"),
            Some(&1)
        );
    }
}
