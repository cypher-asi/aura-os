use std::sync::OnceLock;

use aura_os_core::OrgIntegration;
use axum::extract::Path;
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;

mod catalog;
mod integrations;
mod secrets;
mod trusted_mcp_warnings;

pub(super) fn trusted_mcp_script_test_lock() -> &'static AsyncMutex<()> {
    static LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| AsyncMutex::new(()))
}

pub(super) async fn start_mock_integrations_server(
    integrations: Vec<OrgIntegration>,
    secret: Option<&'static str>,
) -> String {
    let listed_integrations = integrations.clone();
    let app = Router::new()
        .route(
            "/internal/orgs/:org_id/integrations",
            get(move |Path(_org_id): Path<String>| {
                let integrations = listed_integrations.clone();
                async move { Json(integrations) }
            }),
        )
        .route(
            "/internal/orgs/:org_id/integrations/:integration_id/secret",
            get(
                move |Path((_org_id, _integration_id)): Path<(String, String)>| async move {
                    Json(serde_json::json!({ "secret": secret }))
                },
            ),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{address}")
}

pub(super) async fn start_mock_public_integrations_server(
    expected_bearer: &'static str,
    integrations: Vec<OrgIntegration>,
    secret: Option<&'static str>,
) -> String {
    let listed_integrations = integrations.clone();
    let expected_auth = format!("Bearer {expected_bearer}");
    let list_expected_auth = expected_auth.clone();
    let secret_expected_auth = expected_auth.clone();
    let app = Router::new()
        .route(
            "/api/orgs/:org_id/integrations",
            get(move |Path(_org_id): Path<String>, headers: HeaderMap| {
                let integrations = listed_integrations.clone();
                let expected_auth = list_expected_auth.clone();
                async move {
                    if headers
                        .get(header::AUTHORIZATION)
                        .and_then(|value| value.to_str().ok())
                        != Some(expected_auth.as_str())
                    {
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(serde_json::json!({ "error": "unauthorized" })),
                        );
                    }
                    (
                        StatusCode::OK,
                        Json(serde_json::to_value(integrations).expect("serialize integrations")),
                    )
                }
            }),
        )
        .route(
            "/api/orgs/:org_id/integrations/:integration_id/secret",
            get(
                move |Path((_org_id, _integration_id)): Path<(String, String)>,
                      headers: HeaderMap| {
                    let expected_auth = secret_expected_auth.clone();
                    async move {
                        if headers
                            .get(header::AUTHORIZATION)
                            .and_then(|value| value.to_str().ok())
                            != Some(expected_auth.as_str())
                        {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(serde_json::json!({ "error": "unauthorized" })),
                            );
                        }
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({ "secret": secret })),
                        )
                    }
                },
            ),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{address}")
}
