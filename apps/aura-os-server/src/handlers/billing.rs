use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{BillingAccount, OrgId, TransactionsResponse};

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

    {
        let mut cache = state.credit_cache.lock().await;
        cache.retain(|_, c| c.last_check.elapsed() < CACHE_TTL);
        if let Some(c) = cache.get(jwt) {
            if c.has_credits && c.last_check.elapsed() < CACHE_TTL {
                return Ok(());
            }
        }
    }

    let result = state.billing_client.ensure_has_credits(jwt).await;

    let has_credits = result.is_ok();
    {
        let mut cache = state.credit_cache.lock().await;
        cache.insert(
            jwt.to_string(),
            CreditCache {
                last_check: Instant::now(),
                has_credits,
            },
        );
    }

    result.map_err(billing_err)?;
    Ok(())
}

pub(crate) async fn require_credits_for_auth_source(
    state: &AppState,
    jwt: &str,
    auth_source: &str,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    if auth_source == "aura_managed" {
        require_credits(state, jwt).await
    } else {
        Ok(())
    }
}

pub(crate) async fn get_credit_balance(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(_org_id): Path<OrgId>,
) -> ApiResult<Json<serde_json::Value>> {
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
    use aura_os_link::{AutomatonClient, HarnessLink, LocalHarness, SwarmHarness};
    use aura_os_orgs::OrgService;
    use aura_os_projects::ProjectService;
    use aura_os_sessions::SessionService;
    use aura_os_store::SettingsStore;
    use aura_os_agent_runtime::AgentRuntimeService;
    use aura_os_tasks::TaskService;

    use crate::HarnessHttpGateway;

    #[derive(Default)]
    struct MockBillingState {
        balance_calls: HashMap<String, usize>,
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
        let automaton_client = Arc::new(AutomatonClient::new(&harness_base));
        let harness_http = Arc::new(HarnessHttpGateway::new(harness_base.clone()));
        let router_url = "http://localhost:19080".to_string();
        let process_executor = Arc::new(aura_os_process::ProcessExecutor::new(
            event_broadcast.clone(),
            store_dir.path().to_path_buf(),
            store.clone(),
            agent_service.clone(),
            org_service.clone(),
            automaton_client.clone(),
            None,
            task_service.clone(),
            router_url.clone(),
            reqwest::Client::new(),
        ));
        let tool_registry = {
            let mut registry = aura_os_agent_tools::build_all_tools_registry();
            aura_os_agent_tools::register_process_tools(&mut registry, process_executor.clone());
            Arc::new(registry)
        };
        let agent_runtime = Arc::new(AgentRuntimeService::new(
            tool_registry,
            process_executor,
            router_url,
            project_service.clone(),
            agent_service.clone(),
            agent_instance_service.clone(),
            task_service.clone(),
            session_service.clone(),
            org_service.clone(),
            billing_client.clone(),
            automaton_client.clone(),
            None,
            None,
            None,
            store.clone(),
            event_broadcast.clone(),
            local_harness.clone(),
        ));

        (
            AppState {
                data_dir: store_dir.path().to_path_buf(),
                store,
                org_service,
                auth_service,
                billing_client,
                project_service,
                task_service,
                agent_service,
                agent_instance_service,
                session_service,
                local_harness,
                swarm_harness,
                harness_sessions: Arc::new(Mutex::new(HashMap::new())),
                terminal_manager: Arc::new(aura_os_terminal::TerminalManager::new()),
                browser_manager: Arc::new(aura_os_browser::BrowserManager::new(aura_os_browser::BrowserConfig::default())),
                network_client: None,
                feedback_network_client: None,
                storage_client: None,
                integrations_client: None,
                event_broadcast,
                require_zero_pro: false,
                chat_sessions: Arc::new(Mutex::new(HashMap::new())),
                credit_cache: Arc::new(Mutex::new(HashMap::new())),
                automaton_client,
                harness_http,
                automaton_registry: Arc::new(Mutex::new(HashMap::new())),
                swarm_base_url: None,
                task_output_cache: Arc::new(Mutex::new(HashMap::new())),
                orbit_client: None,
                validation_cache: Arc::new(dashmap::DashMap::new()),
                agent_runtime,
                permissions_cache: aura_os_agent_runtime::policy::PermissionsCache::new(),
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
}
