use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

#[tokio::test]
async fn org_integrations_support_tool_and_model_provider_strings() {
    let (app, _state, _db) = build_test_app();
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "GitHub Ops",
            "provider": "github",
            "kind": "workspace_integration",
            "default_model": null,
            "api_key": "ghp_test_123"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = response_json(resp).await;
    let integration_id = created["integration_id"].as_str().unwrap().to_string();
    assert_eq!(created["name"], "GitHub Ops");
    assert_eq!(created["provider"], "github");
    assert_eq!(created["kind"], "workspace_integration");
    assert_eq!(created["default_model"], serde_json::Value::Null);
    assert_eq!(created["has_secret"], true);
    assert_eq!(created["enabled"], true);

    let req = json_request("GET", &format!("/api/orgs/{org_id}/integrations"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["provider"], "github");

    let req = json_request(
        "PUT",
        &format!("/api/orgs/{org_id}/integrations/{integration_id}"),
        Some(serde_json::json!({
            "name": "OpenAI Shared",
            "provider": "openai",
            "kind": "workspace_connection",
            "default_model": "gpt-5.1",
            "api_key": "sk-test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["name"], "OpenAI Shared");
    assert_eq!(updated["provider"], "openai");
    assert_eq!(updated["kind"], "workspace_connection");
    assert_eq!(updated["default_model"], "gpt-5.1");
    assert_eq!(updated["has_secret"], true);
    assert_eq!(updated["enabled"], true);

    let req = json_request(
        "DELETE",
        &format!("/api/orgs/{org_id}/integrations/{integration_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let req = json_request("GET", &format!("/api/orgs/{org_id}/integrations"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert!(listed.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn org_integrations_support_mcp_server_provider_config() {
    let (app, state, _db) = build_test_app();
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "GitHub MCP",
            "provider": "mcp_server",
            "kind": "mcp_server",
            "provider_config": {
                "transport": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "secretEnvVar": "GITHUB_PERSONAL_ACCESS_TOKEN"
            },
            "api_key": "ghp_test_123"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = response_json(resp).await;
    let integration_id = created["integration_id"].as_str().unwrap().to_string();
    assert_eq!(created["kind"], "mcp_server");
    assert_eq!(created["provider"], "mcp_server");
    assert_eq!(created["provider_config"]["transport"], "stdio");
    assert_eq!(created["enabled"], true);
    assert_eq!(
        created["provider_config"]["secretEnvVar"],
        "GITHUB_PERSONAL_ACCESS_TOKEN"
    );
    assert_eq!(
        state
            .org_service
            .get_integration_secret(&integration_id)
            .unwrap()
            .as_deref(),
        Some("ghp_test_123")
    );

    let req = json_request("GET", &format!("/api/orgs/{org_id}/integrations"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["kind"], "mcp_server");
    assert_eq!(listed[0]["provider_config"]["command"], "npx");

    let req = json_request(
        "PUT",
        &format!("/api/orgs/{org_id}/integrations/{integration_id}"),
        Some(serde_json::json!({
            "api_key": null
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["has_secret"], false);
    assert_eq!(updated["enabled"], true);
    assert_eq!(
        state
            .org_service
            .get_integration_secret(&integration_id)
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn org_integrations_reject_invalid_mcp_server_configs() {
    let (app, _state, _db) = build_test_app();
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Broken MCP",
            "provider": "mcp_server",
            "kind": "mcp_server",
            "provider_config": {
                "transport": "stdio"
            }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Broken HTTP MCP",
            "provider": "mcp_server",
            "kind": "mcp_server",
            "provider_config": {
                "transport": "http",
                "url": "not-a-url"
            }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

#[tokio::test]
async fn org_integrations_reject_invalid_workspace_integration_configs() {
    let (app, _state, _db) = build_test_app();
    let org_id = OrgId::new();

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Metricool",
            "provider": "metricool",
            "kind": "workspace_integration",
            "api_key": "metricool_test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/integrations"),
        Some(serde_json::json!({
            "name": "Mailchimp",
            "provider": "mailchimp",
            "kind": "workspace_integration",
            "api_key": "mailchimp_test-us19",
            "provider_config": {
                "serverPrefix": ""
            }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}
