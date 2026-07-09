//! Helpers for reconstructing the dev-loop automaton transport.
//!
//! Local runs talk to the loopback harness without a bearer. Remote
//! swarm runs use the gateway's agent-scoped local-harness-compatible
//! surface (`/v1/agents/:id/...`) and must carry the caller JWT as the
//! transport bearer. Keeping that choice here prevents remote URLs from
//! accidentally falling through the hosted-local-harness fail-closed
//! guard that protects `LOCAL_HARNESS_URL`.

use aura_os_harness::{
    is_hosted_harness_base_url, local_harness_base_url,
    local_harness_transport_auth_token_from_env, LocalHarness,
};

pub(super) fn harness_for_base_url(base_url: String, auth_token: Option<&str>) -> LocalHarness {
    if is_hosted_harness_base_url(&base_url) {
        return LocalHarness::with_transport_auth_token(
            base_url.clone(),
            same_configured_local_harness_base(&base_url)
                .then(local_harness_transport_auth_token_from_env)
                .flatten()
                .or_else(|| {
                    auth_token
                        .filter(|token| !token.trim().is_empty())
                        .map(str::to_string)
                }),
        );
    }
    LocalHarness::for_configured_local_base_url(base_url)
}

fn same_configured_local_harness_base(base_url: &str) -> bool {
    normalize_base_url(base_url) == normalize_base_url(&local_harness_base_url())
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use aura_os_harness::HarnessLink;
    use axum::http::header::AUTHORIZATION;
    use axum::http::HeaderMap;
    use axum::routing::get;
    use axum::{Json, Router};

    use super::harness_for_base_url;

    #[tokio::test]
    async fn hosted_base_with_caller_jwt_sends_bearer_auth() {
        async fn status(headers: HeaderMap) -> Json<serde_json::Value> {
            assert_eq!(
                headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()),
                Some("Bearer user-jwt")
            );
            Json(serde_json::json!({ "running": true }))
        }

        let app = Router::new().route("/v1/run/:run_id/status", get(status));
        let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
            .await
            .expect("bind hosted-looking local addr");
        let addr = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        let harness = harness_for_base_url(format!("http://{addr}"), Some("user-jwt"));
        let status = harness
            .run_status("run-1", None)
            .await
            .expect("status request should use caller jwt as bearer");

        assert_eq!(status["running"], true);
    }

    #[tokio::test]
    async fn hosted_base_without_any_token_remains_fail_closed() {
        let harness = harness_for_base_url(
            "https://swarm.example.com/v1/agents/agent-1".to_string(),
            None,
        );

        let error = harness
            .run_status("run-1", None)
            .await
            .expect_err("hosted base without transport auth must fail closed");

        assert!(error.to_string().contains("LOCAL_HARNESS_AUTH_TOKEN"));
    }
}
