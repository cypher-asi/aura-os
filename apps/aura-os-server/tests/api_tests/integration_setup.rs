use axum::http::StatusCode;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

use super::integration_provider_mock::build_provider_mock;

/// RAII guard for the AURA_*_API_BASE_URL env vars set during integration
/// tests. Tests own the guard; once dropped, the vars are removed so a later
/// test does not inherit a dead listener URL.
pub struct ProviderEnvGuard;

impl ProviderEnvGuard {
    pub async fn set_up() -> Self {
        let provider_app = build_provider_mock();

        let provider_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let provider_addr = provider_listener.local_addr().unwrap();
        let provider_url = format!("http://{}", provider_addr);
        tokio::spawn(async move { axum::serve(provider_listener, provider_app).await.ok() });

        unsafe {
            std::env::set_var("AURA_GITHUB_API_BASE_URL", format!("{provider_url}/github"));
            std::env::set_var(
                "AURA_LINEAR_API_BASE_URL",
                format!("{provider_url}/linear/graphql"),
            );
            std::env::set_var("AURA_SLACK_API_BASE_URL", format!("{provider_url}/slack"));
            std::env::set_var("AURA_NOTION_API_BASE_URL", format!("{provider_url}/notion"));
            std::env::set_var(
                "AURA_BRAVE_SEARCH_API_BASE_URL",
                format!("{provider_url}/brave"),
            );
            std::env::set_var(
                "AURA_FREEPIK_API_BASE_URL",
                format!("{provider_url}/freepik"),
            );
            std::env::set_var("AURA_BUFFER_API_BASE_URL", format!("{provider_url}/buffer"));
            std::env::set_var("AURA_APIFY_API_BASE_URL", format!("{provider_url}/apify"));
            std::env::set_var(
                "AURA_METRICOOL_API_BASE_URL",
                format!("{provider_url}/metricool"),
            );
            std::env::set_var(
                "AURA_MAILCHIMP_API_BASE_URL",
                format!("{provider_url}/mailchimp"),
            );
            std::env::set_var("AURA_RESEND_API_BASE_URL", format!("{provider_url}/resend"));
        }

        Self
    }
}

impl Drop for ProviderEnvGuard {
    fn drop(&mut self) {
        unsafe {
            std::env::remove_var("AURA_GITHUB_API_BASE_URL");
            std::env::remove_var("AURA_LINEAR_API_BASE_URL");
            std::env::remove_var("AURA_SLACK_API_BASE_URL");
            std::env::remove_var("AURA_NOTION_API_BASE_URL");
            std::env::remove_var("AURA_BRAVE_SEARCH_API_BASE_URL");
            std::env::remove_var("AURA_FREEPIK_API_BASE_URL");
            std::env::remove_var("AURA_BUFFER_API_BASE_URL");
            std::env::remove_var("AURA_APIFY_API_BASE_URL");
            std::env::remove_var("AURA_METRICOOL_API_BASE_URL");
            std::env::remove_var("AURA_MAILCHIMP_API_BASE_URL");
            std::env::remove_var("AURA_RESEND_API_BASE_URL");
        }
    }
}

pub async fn create_test_integrations(app: &Router, org_id: &OrgId) {
    for payload in integration_payloads() {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/integrations"),
            Some(payload),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }
}

fn integration_payloads() -> [serde_json::Value; 11] {
    [
        serde_json::json!({
            "name": "GitHub",
            "provider": "github",
            "kind": "workspace_integration",
            "api_key": "ghp_test"
        }),
        serde_json::json!({
            "name": "Linear",
            "provider": "linear",
            "kind": "workspace_integration",
            "api_key": "lin_api_test"
        }),
        serde_json::json!({
            "name": "Slack",
            "provider": "slack",
            "kind": "workspace_integration",
            "api_key": "xoxb-test"
        }),
        serde_json::json!({
            "name": "Notion",
            "provider": "notion",
            "kind": "workspace_integration",
            "api_key": "secret_test"
        }),
        serde_json::json!({
            "name": "Brave Search",
            "provider": "brave_search",
            "kind": "workspace_integration",
            "api_key": "brave_test"
        }),
        serde_json::json!({
            "name": "Freepik",
            "provider": "freepik",
            "kind": "workspace_integration",
            "api_key": "freepik_test"
        }),
        serde_json::json!({
            "name": "Buffer",
            "provider": "buffer",
            "kind": "workspace_integration",
            "api_key": "buffer_test"
        }),
        serde_json::json!({
            "name": "Apify",
            "provider": "apify",
            "kind": "workspace_integration",
            "api_key": "apify_test"
        }),
        serde_json::json!({
            "name": "Metricool",
            "provider": "metricool",
            "kind": "workspace_integration",
            "api_key": "metricool_test",
            "provider_config": {
                "userId": "123456",
                "blogId": "654321"
            }
        }),
        serde_json::json!({
            "name": "Mailchimp",
            "provider": "mailchimp",
            "kind": "workspace_integration",
            "api_key": "mailchimp_test-us19",
            "provider_config": {
                "serverPrefix": "us19"
            }
        }),
        serde_json::json!({
            "name": "Resend",
            "provider": "resend",
            "kind": "workspace_integration",
            "api_key": "re_test"
        }),
    ]
}
