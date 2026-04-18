use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use tracing::warn;

use aura_os_auth::AuthError;
use aura_os_core::ZeroAuthSession;

use crate::error::ApiError;
use crate::state::{
    persist_zero_auth_session, AppState, AuthJwt, AuthSession, AuthZeroProMeta, CachedSession,
};

const AUTH_REFRESH_TTL: std::time::Duration = std::time::Duration::from_secs(5 * 60);

fn map_auth_error(e: AuthError) -> (StatusCode, Json<ApiError>) {
    match e {
        AuthError::ZosApi {
            status: 401,
            message,
            ..
        } => ApiError::unauthorized(if message.is_empty() {
            "session expired or invalid".to_string()
        } else {
            message
        }),
        AuthError::Http(err) => {
            ApiError::service_unavailable(format!("unable to reach zOS API: {err}"))
        }
        other => ApiError::bad_gateway(other.to_string()),
    }
}

fn enforce_zero_pro(
    state: &AppState,
    session: &ZeroAuthSession,
) -> Result<(), (StatusCode, Json<ApiError>)> {
    if !state.require_zero_pro {
        return Ok(());
    }

    if session.is_zero_pro {
        Ok(())
    } else {
        Err(ApiError::forbidden("ZERO Pro subscription required"))
    }
}

/// Extract a JWT from the request: first checks the `Authorization: Bearer`
/// header, then falls back to the `?token=` query parameter (used by WebSocket
/// connections where browsers cannot send custom headers).
fn extract_request_token(req: &Request) -> Option<String> {
    // Primary: Authorization header
    if let Some(token) = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|val| val.strip_prefix("Bearer "))
    {
        return Some(token.to_string());
    }

    // Fallback: ?token= query param (WebSocket connections)
    req.uri()
        .query()
        .and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("token=")))
        .map(|t| t.to_string())
}

/// Check the validation cache for a fresh session. Returns the session if
/// cached and within the refresh TTL.
fn get_cached_session(state: &AppState, jwt: &str) -> Option<(ZeroAuthSession, Option<String>)> {
    let entry = state.validation_cache.get(jwt)?;
    if entry.validated_at.elapsed() < AUTH_REFRESH_TTL {
        Some((entry.session.clone(), entry.zero_pro_refresh_error.clone()))
    } else {
        None
    }
}

/// Validate a JWT against zOS and update the cache.
async fn validate_and_cache(
    state: &AppState,
    jwt: &str,
) -> Result<(ZeroAuthSession, Option<String>), (StatusCode, Json<ApiError>)> {
    let result = state
        .auth_service
        .validate_token(jwt)
        .await
        .map_err(map_auth_error)?;

    let zero_pro_refresh_error = result.zero_pro_refresh_error.clone();
    let session = result.session.clone();

    state.validation_cache.insert(
        jwt.to_string(),
        CachedSession {
            session: session.clone(),
            validated_at: Instant::now(),
            zero_pro_refresh_error: zero_pro_refresh_error.clone(),
        },
    );

    Ok((session, zero_pro_refresh_error))
}

/// Resolve a session from a JWT: check cache first (unless `allow_validation_cache` is false),
/// then validate with zOS. On zOS network failure, falls back to a stale cached entry if available.
async fn resolve_session_from_jwt(
    state: &AppState,
    jwt: &str,
    allow_validation_cache: bool,
) -> Result<(ZeroAuthSession, Option<String>), (StatusCode, Json<ApiError>)> {
    if allow_validation_cache {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok((session, zp));
        }
    }

    match validate_and_cache(state, jwt).await {
        Ok(pair) => Ok(pair),
        Err(err) if err.0 == StatusCode::UNAUTHORIZED => Err(err),
        Err(err) => {
            // zOS unreachable — try stale cache entry as fallback
            if let Some(entry) = state.validation_cache.get(jwt) {
                warn!(
                    user_id = %entry.session.user_id,
                    "zOS unreachable, using stale cached session"
                );
                Ok((entry.session.clone(), entry.zero_pro_refresh_error.clone()))
            } else {
                Err(err)
            }
        }
    }
}

pub(crate) async fn require_verified_session(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiError>)> {
    let token = extract_request_token(&req)
        .ok_or_else(|| ApiError::unauthorized("missing authorization token"))?;
    // POST /api/auth/validate skips the in-memory TTL cache so explicit refresh always hits zOS once.
    let allow_validation_cache =
        !(req.method() == axum::http::Method::POST && req.uri().path() == "/api/auth/validate");
    let (session, zero_pro_refresh_error) =
        resolve_session_from_jwt(&state, &token, allow_validation_cache).await?;
    persist_zero_auth_session(&state.store, &session);

    enforce_zero_pro(&state, &session)?;

    req.extensions_mut().insert(AuthJwt(token));
    req.extensions_mut().insert(AuthSession(session));
    req.extensions_mut().insert(AuthZeroProMeta {
        zero_pro_refresh_error,
    });

    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
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
    fn extract_token_from_query_param() {
        let req = request_with_query("token=ws-jwt-token");
        assert_eq!(extract_request_token(&req).unwrap(), "ws-jwt-token");
    }

    #[test]
    fn extract_token_from_query_with_other_params() {
        let req = request_with_query("foo=bar&token=my-token&baz=1");
        assert_eq!(extract_request_token(&req).unwrap(), "my-token");
    }

    #[test]
    fn extract_token_prefers_header_over_query() {
        let req = axum::http::Request::builder()
            .uri("/api/test?token=query-token")
            .header("Authorization", "Bearer header-token")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_request_token(&req).unwrap(), "header-token");
    }

    #[test]
    fn extract_token_returns_none_when_absent() {
        let req = request_bare();
        assert!(extract_request_token(&req).is_none());
    }

    #[test]
    fn extract_token_empty_bearer_value() {
        let req = request_with_auth_header("Bearer ");
        // "Bearer " with trailing space — strip_prefix("Bearer ") returns ""
        assert_eq!(extract_request_token(&req).unwrap(), "");
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
            aura_os_store::RocksStore::open(
                &std::env::temp_dir().join(format!("aura-test-guard-{}-{id}", std::process::id())),
            )
            .unwrap(),
        );
        let (event_broadcast, _) = tokio::sync::broadcast::channel(16);
        let local_harness: Arc<dyn aura_os_link::HarnessLink> = Arc::new(
            aura_os_link::LocalHarness::new("http://localhost:8080".to_string()),
        );
        let super_agent_service = Arc::new(aura_os_super_agent::SuperAgentService::new(
            "http://localhost:9998".to_string(),
            Arc::new(aura_os_projects::ProjectService::new(store.clone())),
            Arc::new(aura_os_agents::AgentService::new(store.clone(), None)),
            Arc::new(aura_os_agents::AgentInstanceService::new(
                store.clone(),
                None,
                Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
                None,
            )),
            Arc::new(aura_os_tasks::TaskService::new(store.clone(), None)),
            Arc::new(aura_os_sessions::SessionService::new(
                store.clone(),
                0.8,
                200_000,
            )),
            Arc::new(aura_os_orgs::OrgService::new(store.clone())),
            Arc::new(aura_os_billing::BillingClient::new()),
            Arc::new(aura_os_link::AutomatonClient::new("http://localhost:9999")),
            None,
            None,
            None,
            store.clone(),
            event_broadcast.clone(),
            local_harness,
            std::env::temp_dir(),
        ));

        AppState {
            data_dir: std::env::temp_dir(),
            store: store.clone(),
            org_service: Arc::new(aura_os_orgs::OrgService::new(store.clone())),
            auth_service: Arc::new(aura_os_auth::AuthService::new()),
            billing_client: Arc::new(aura_os_billing::BillingClient::new()),
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
            local_harness: Arc::new(aura_os_link::LocalHarness::from_env()),
            swarm_harness: Arc::new(aura_os_link::SwarmHarness::from_env()),
            harness_sessions: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            terminal_manager: Arc::new(aura_os_terminal::TerminalManager::new()),
            browser_manager: Arc::new(aura_os_browser::BrowserManager::new(aura_os_browser::BrowserConfig::default())),
            network_client: None,
            feedback_network_client: None,
            storage_client: None,
            integrations_client: None,
            event_broadcast,
            require_zero_pro: false,
            chat_sessions: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            credit_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            automaton_client: Arc::new(aura_os_link::AutomatonClient::new("http://localhost:9999")),
            harness_http: Arc::new(crate::HarnessHttpGateway::new("http://localhost:9999")),
            automaton_registry: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            swarm_base_url: None,
            task_output_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            orbit_client: None,
            validation_cache: cache,
            super_agent_service,
        }
    }

    fn mock_app_state_pro_required(require_pro: bool) -> AppState {
        let mut state = mock_app_state_with_cache(make_cache());
        state.require_zero_pro = require_pro;
        state
    }
}
