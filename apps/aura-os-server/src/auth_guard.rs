use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use tracing::warn;

use aura_os_auth::AuthError;
use aura_os_core::ZeroAuthSession;

use crate::capture_auth::{capture_session_from_access_token, is_capture_access_token};
use crate::error::ApiError;
use crate::state::{
    persist_zero_auth_session, AppState, AuthJwt, AuthSession, AuthZeroProMeta, CachedSession,
};

const AUTH_REFRESH_TTL: Duration = Duration::from_secs(5 * 60);
const AUTH_STALE_FALLBACK_MAX_AGE: Duration = Duration::from_secs(30 * 60);
const AUTH_DEGRADED_HEADER: &str = "X-Aura-Auth-Degraded";

#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthDegraded;

struct AuthResolution {
    session: ZeroAuthSession,
    zero_pro_refresh_error: Option<String>,
    degraded: bool,
}

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

fn get_stale_cached_session(
    state: &AppState,
    jwt: &str,
) -> Option<(ZeroAuthSession, Option<String>)> {
    let entry = state.validation_cache.get(jwt)?;
    if entry.validated_at.elapsed() <= AUTH_STALE_FALLBACK_MAX_AGE {
        Some((entry.session.clone(), entry.zero_pro_refresh_error.clone()))
    } else {
        None
    }
}

fn is_sensitive_auth_path(method: &Method, path: &str) -> bool {
    if path.contains("/billing")
        || path.contains("/credits/")
        || path.ends_with("/account")
        || path.contains("/secrets")
        || path.contains("/secret")
        || path.contains("/integrations")
        || path.contains("/integration-config")
    {
        return true;
    }

    path.contains("/tool-actions") && *method != Method::GET
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
    allow_stale_fallback: bool,
) -> Result<AuthResolution, (StatusCode, Json<ApiError>)> {
    if is_capture_access_token(jwt) {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: zp,
                degraded: false,
            });
        }
        if let Some(session) = capture_session_from_access_token(jwt) {
            state.validation_cache.insert(
                jwt.to_string(),
                CachedSession {
                    session: session.clone(),
                    validated_at: Instant::now(),
                    zero_pro_refresh_error: None,
                },
            );
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: None,
                degraded: false,
            });
        }
        return Err(ApiError::unauthorized("capture session expired"));
    }

    if allow_validation_cache {
        if let Some((session, zp)) = get_cached_session(state, jwt) {
            return Ok(AuthResolution {
                session,
                zero_pro_refresh_error: zp,
                degraded: false,
            });
        }
    }

    match validate_and_cache(state, jwt).await {
        Ok((session, zero_pro_refresh_error)) => Ok(AuthResolution {
            session,
            zero_pro_refresh_error,
            degraded: false,
        }),
        Err(err) if err.0 == StatusCode::UNAUTHORIZED => Err(err),
        Err(err) => {
            if !allow_stale_fallback {
                return Err(err);
            }

            // zOS unreachable -- try stale cache entry as fallback
            if let Some((session, zero_pro_refresh_error)) = get_stale_cached_session(state, jwt) {
                warn!(
                    user_id = %session.user_id,
                    "zOS unreachable, using stale cached session"
                );
                Ok(AuthResolution {
                    session,
                    zero_pro_refresh_error,
                    degraded: true,
                })
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
    let allow_stale_fallback = !is_sensitive_auth_path(req.method(), req.uri().path());
    let AuthResolution {
        session,
        zero_pro_refresh_error,
        degraded,
    } = resolve_session_from_jwt(&state, &token, allow_validation_cache, allow_stale_fallback)
        .await?;
    if !is_capture_access_token(&token) {
        persist_zero_auth_session(&state.store, &session);
    }

    enforce_zero_pro(&state, &session)?;

    req.extensions_mut().insert(AuthJwt(token));
    req.extensions_mut().insert(AuthSession(session));
    req.extensions_mut().insert(AuthZeroProMeta {
        zero_pro_refresh_error,
    });
    if degraded {
        req.extensions_mut().insert(AuthDegraded);
    }

    let mut response = next.run(req).await;
    if degraded {
        response
            .headers_mut()
            .insert(AUTH_DEGRADED_HEADER, HeaderValue::from_static("true"));
    }
    Ok(response)
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
        // "Bearer " with trailing space -- strip_prefix("Bearer ") returns ""
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
            event_broadcast,
            event_hub,
            loop_registry,
            require_zero_pro: false,
            chat_sessions: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            credit_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            automaton_client: Arc::new(aura_os_harness::AutomatonClient::new(
                "http://localhost:9999",
            )),
            harness_http: Arc::new(crate::HarnessHttpGateway::new("http://localhost:9999")),
            automaton_registry: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            swarm_base_url: None,
            task_output_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            orbit_client: None,
            orbit_capacity_guard: std::sync::Arc::new(crate::orbit_guard::OrbitCapacityGuard::new()),
            validation_cache: cache,
            agent_discovery_cache: Arc::new(dashmap::DashMap::new()),
            router_url,
            http_client: reqwest::Client::new(),
            agent_event_listener,
            loop_log: Arc::new(crate::loop_log::LoopLogWriter::new(
                std::env::temp_dir().join(format!("aura-test-loop-{}-{id}", std::process::id())),
            )),
        }
    }

    fn mock_app_state_pro_required(require_pro: bool) -> AppState {
        let mut state = mock_app_state_with_cache(make_cache());
        state.require_zero_pro = require_pro;
        state
    }
}
