use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

use super::integration_actions::*;
use super::integration_setup::{create_test_integrations, ProviderEnvGuard};

#[tokio::test]
async fn org_tool_actions_use_saved_integrations() {
    let _env = ProviderEnvGuard::set_up().await;

    let (app, _state, _db) = build_test_app();
    let org_id = OrgId::new();

    create_test_integrations(&app, &org_id).await;

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed["integrations"].as_array().unwrap().len(), 11);

    assert_github_actions(&app, &org_id).await;
    assert_linear_actions(&app, &org_id).await;
    assert_slack_actions(&app, &org_id).await;
    assert_notion_actions(&app, &org_id).await;
    assert_brave_actions(&app, &org_id).await;
    assert_freepik_actions(&app, &org_id).await;
    assert_apify_actions(&app, &org_id).await;
    assert_metricool_actions(&app, &org_id).await;
    assert_mailchimp_actions(&app, &org_id).await;
    assert_resend_actions(&app, &org_id).await;
}

#[tokio::test]
async fn disabled_workspace_integrations_are_kept_but_not_exposed_as_active_capabilities() {
    let (app, _state, _db) = build_test_app();
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Brave Search",
            "provider": "brave_search",
            "kind": "workspace_integration",
            "api_key": "brave_test",
            "enabled": false
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = response_json(resp).await;
    assert_eq!(created["enabled"], false);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed["integrations"][0]["enabled"], false);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({
            "query": "aura"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}
