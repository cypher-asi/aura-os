mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_core::*;

use common::*;

// ---------------------------------------------------------------------------
// Project Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_crud() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    // Create
    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "Test Project",
            "description": "A test"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let project_id = body["project_id"].as_str().unwrap().to_string();
    assert_eq!(body["name"], "Test Project");

    // List (org-scoped; no org_id returns empty)
    let req = json_request("GET", &format!("/api/projects?org_id={}", org_id), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 1);

    // Get
    let req = json_request("GET", &format!("/api/projects/{project_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Test Project");

    // Update
    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}"),
        Some(serde_json::json!({"name": "Updated Name"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Updated Name");

    // Archive (returns project from network; archive status not yet supported on network)
    let req = json_request("POST", &format!("/api/projects/{project_id}/archive"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body.get("project_id").is_some() || body.get("name").is_some());
}

#[tokio::test]
async fn project_not_found() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "network_error");
}

#[tokio::test]
async fn project_create_invalid_name() {
    let (app, _, _db) = build_test_app();

    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "",
            "description": "desc"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

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

#[tokio::test]
async fn org_tool_actions_use_saved_integrations() {
    let provider_app = Router::new()
        .route(
            "/github/user/repos",
            get(|| async {
                Json(serde_json::json!([{
                    "name": "hello-world",
                    "full_name": "octocat/hello-world",
                    "private": false,
                    "html_url": "https://github.com/octocat/hello-world",
                    "default_branch": "main",
                    "description": "Test repo"
                }]))
            }),
        )
        .route(
            "/github/repos/octocat/hello-world/issues",
            get(|| async {
                Json(serde_json::json!([{
                    "number": 42,
                    "title": "Aura issue",
                    "state": "open",
                    "html_url": "https://github.com/octocat/hello-world/issues/42",
                    "user": { "login": "octocat" }
                }]))
            })
            .post(|| async {
                (
                    StatusCode::CREATED,
                    Json(serde_json::json!({
                        "number": 42,
                        "title": "Aura issue",
                        "state": "open",
                        "html_url": "https://github.com/octocat/hello-world/issues/42"
                    })),
                )
            }),
        )
        .route(
            "/github/repos/octocat/hello-world/issues/42/comments",
            post(|| async {
                (
                    StatusCode::CREATED,
                    Json(serde_json::json!({
                        "id": 9001,
                        "html_url": "https://github.com/octocat/hello-world/issues/42#issuecomment-9001",
                        "body": "Ship it",
                        "user": { "login": "aura" }
                    })),
                )
            }),
        )
        .route(
            "/github/repos/octocat/hello-world/pulls",
            get(|| async {
                Json(serde_json::json!([{
                    "number": 7,
                    "title": "Aura PR",
                    "state": "open",
                    "html_url": "https://github.com/octocat/hello-world/pull/7",
                    "head": { "ref": "feature/aura" },
                    "base": { "ref": "main" }
                }]))
            })
            .post(|| async {
                (
                    StatusCode::CREATED,
                    Json(serde_json::json!({
                        "number": 7,
                        "title": "Aura PR",
                        "state": "open",
                        "html_url": "https://github.com/octocat/hello-world/pull/7"
                    })),
                )
            }),
        )
        .route(
            "/linear/graphql",
            post(|Json(payload): Json<serde_json::Value>| async move {
                let query = payload["query"].as_str().unwrap_or_default();
                if query.contains("AuraLinearTeams") {
                    Json(serde_json::json!({
                        "data": {
                            "teams": { "nodes": [{ "id": "team-1", "name": "Platform", "key": "PLAT" }] }
                        }
                    }))
                } else if query.contains("AuraLinearIssues") {
                    Json(serde_json::json!({
                        "data": {
                            "issues": {
                                "nodes": [{
                                    "id": "lin-1",
                                    "identifier": "PLAT-42",
                                    "title": "Aura linear issue",
                                    "url": "https://linear.app/test/issue/PLAT-42",
                                    "state": { "id": "state-1", "name": "Backlog", "type": "backlog" },
                                    "team": { "id": "team-1", "name": "Platform", "key": "PLAT" }
                                }]
                            }
                        }
                    }))
                } else if query.contains("AuraLinearIssueUpdate") {
                    Json(serde_json::json!({
                        "data": {
                            "issueUpdate": {
                                "success": true,
                                "issue": {
                                    "id": "lin-1",
                                    "identifier": "PLAT-42",
                                    "title": "Aura linear issue",
                                    "url": "https://linear.app/test/issue/PLAT-42",
                                    "state": { "id": "state-2", "name": "In Progress", "type": "started" }
                                }
                            }
                        }
                    }))
                } else if query.contains("AuraLinearCommentCreate") {
                    Json(serde_json::json!({
                        "data": {
                            "commentCreate": {
                                "success": true,
                                "comment": {
                                    "id": "comment-1",
                                    "body": "Looking good"
                                }
                            }
                        }
                    }))
                } else {
                    Json(serde_json::json!({
                        "data": {
                            "issueCreate": {
                                "success": true,
                                "issue": {
                                    "id": "lin-1",
                                    "identifier": "PLAT-42",
                                    "title": "Aura linear issue",
                                    "url": "https://linear.app/test/issue/PLAT-42",
                                    "state": { "name": "Backlog" },
                                    "team": { "id": "team-1", "name": "Platform", "key": "PLAT" }
                                }
                            }
                        }
                    }))
                }
            }),
        )
        .route(
            "/slack/conversations.list",
            get(|| async {
                Json(serde_json::json!({
                    "ok": true,
                    "channels": [{ "id": "C123", "name": "eng", "is_private": false }]
                }))
            }),
        )
        .route(
            "/slack/chat.postMessage",
            post(|| async {
                Json(serde_json::json!({
                    "ok": true,
                    "channel": "C123",
                    "ts": "1710000000.000100"
                }))
            }),
        )
        .route(
            "/notion/search",
            post(|| async {
                Json(serde_json::json!({
                    "results": [{
                        "id": "page-1",
                        "url": "https://notion.so/page-1",
                        "properties": {
                            "title": {
                                "title": [{ "plain_text": "Team Notes" }]
                            }
                        }
                    }]
                }))
            }),
        )
        .route(
            "/notion/pages",
            post(|| async {
                Json(serde_json::json!({
                    "id": "page-2",
                    "url": "https://notion.so/page-2",
                    "properties": {
                        "title": {
                            "title": [{ "plain_text": "Aura Page" }]
                        }
                    }
                }))
            }),
        )
        .route(
            "/brave/res/v1/web/search",
            get(|| async {
                Json(serde_json::json!({
                    "web": {
                        "results": [{
                            "title": "Brave result",
                            "url": "https://example.com",
                            "description": "Example result"
                        }]
                    },
                    "query": { "more_results_available": false }
                }))
            }),
        )
        .route(
            "/brave/res/v1/news/search",
            get(|| async {
                Json(serde_json::json!({
                    "news": {
                        "results": [{
                            "title": "Brave news",
                            "url": "https://news.example.com",
                            "description": "Headline"
                        }]
                    },
                    "query": { "more_results_available": false }
                }))
            }),
        )
        .route(
            "/freepik/v1/icons",
            get(|| async {
                Json(serde_json::json!({
                    "data": [{
                        "id": 52912,
                        "name": "Cat Icon",
                        "slug": "cat-icon",
                        "family": { "name": "Outline" },
                        "style": { "name": "solid" }
                    }],
                    "meta": { "page": 1 }
                }))
            }),
        )
        .route(
            "/freepik/v1/ai/improve-prompt",
            post(|| async {
                Json(serde_json::json!({
                    "data": {
                        "task_id": "task-1",
                        "status": "CREATED",
                        "generated": []
                    }
                }))
            }),
        )
        .route(
            "/freepik/v1/ai/text-to-image",
            post(|| async {
                Json(serde_json::json!({
                    "data": [{
                        "base64": "ZmFrZS1pbWFnZQ==",
                        "has_nsfw": false
                    }],
                    "meta": {
                        "image": { "size": "square_1_1", "width": 1024, "height": 1024 },
                        "prompt": "Aura mascot"
                    }
                }))
            }),
        )
        .route(
            "/buffer/profiles.json",
            get(|| async {
                Json(serde_json::json!([{
                    "id": "profile-1",
                    "formatted_username": "@aura",
                    "service": "twitter",
                    "service_username": "aura"
                }]))
            }),
        )
        .route(
            "/buffer/updates/create.json",
            post(|| async {
                Json(serde_json::json!({
                    "success": true,
                    "updates": [{
                        "id": "update-1",
                        "status": "buffer",
                        "text": "Ship it",
                        "service": "twitter"
                    }]
                }))
            }),
        )
        .route(
            "/apify/acts",
            get(|| async {
                Json(serde_json::json!({
                    "data": {
                        "items": [{
                            "id": "actor-1",
                            "name": "Example Actor",
                            "username": "aura"
                        }]
                    }
                }))
            }),
        )
        .route(
            "/apify/acts/my-actor/runs",
            post(|| async {
                Json(serde_json::json!({
                    "data": {
                        "id": "run-1",
                        "status": "READY",
                        "actId": "actor-1"
                    }
                }))
            }),
        )
        .route(
            "/apify/actor-runs/run-1",
            get(|| async {
                Json(serde_json::json!({
                    "data": {
                        "id": "run-1",
                        "status": "READY",
                        "actId": "actor-1",
                        "defaultDatasetId": "dataset-1"
                    }
                }))
            }),
        )
        .route(
            "/apify/datasets/dataset-1/items",
            get(|| async {
                Json(serde_json::json!([
                    { "url": "https://example.com/aura", "title": "Aura result" }
                ]))
            }),
        )
        .route(
            "/apify/acts/my-actor/run-sync-get-dataset-items",
            post(|| async {
                Json(serde_json::json!([
                    { "url": "https://example.com/sync", "title": "Sync result" }
                ]))
            }),
        )
        .route(
            "/metricool/admin/simpleProfiles",
            get(|| async {
                Json(serde_json::json!([{
                    "id": 654321,
                    "userId": 123456,
                    "label": "Aura Brand"
                }]))
            }),
        )
        .route(
            "/metricool/stats/posts",
            get(|| async {
                Json(serde_json::json!([{
                    "id": 1,
                    "title": "Metricool post",
                    "url": "https://example.com/post",
                    "published": true
                }]))
            }),
        )
        .route(
            "/mailchimp/lists",
            get(|| async {
                Json(serde_json::json!({
                    "lists": [{
                        "id": "list-1",
                        "name": "Players",
                        "stats": { "member_count": 128 }
                    }]
                }))
            }),
        )
        .route(
            "/mailchimp/campaigns",
            get(|| async {
                Json(serde_json::json!({
                    "campaigns": [{
                        "id": "camp-1",
                        "status": "save",
                        "settings": { "title": "Launch Email" },
                        "emails_sent": 0
                    }]
                }))
            }),
        )
        .route(
            "/mailchimp/lists/list-1/members",
            get(|| async {
                Json(serde_json::json!({
                    "members": [{
                        "id": "member-1",
                        "email_address": "user@example.com",
                        "status": "subscribed",
                        "full_name": "Aura User"
                    }]
                }))
            })
            .post(|| async {
                (
                    StatusCode::CREATED,
                    Json(serde_json::json!({
                        "id": "member-2",
                        "email_address": "new@example.com",
                        "status": "subscribed"
                    })),
                )
            }),
        )
        .route(
            "/mailchimp/campaigns/camp-1/content",
            get(|| async {
                Json(serde_json::json!({
                    "html": "<p>Hello from Aura</p>",
                    "plain_text": "Hello from Aura"
                }))
            }),
        )
        .route(
            "/resend/domains",
            get(|| async {
                Json(serde_json::json!({
                    "object": "list",
                    "has_more": false,
                    "data": [{
                        "id": "domain-1",
                        "name": "example.com",
                        "status": "verified",
                        "created_at": "2024-01-01T00:00:00.000Z",
                        "region": "us-east-1",
                        "capabilities": {
                            "sending": "enabled",
                            "receiving": "disabled"
                        }
                    }]
                }))
            }),
        )
        .route(
            "/resend/emails",
            post(|| async {
                Json(serde_json::json!({
                    "id": "email-1"
                }))
            }),
        );

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

    let (app, _state, _db) = build_test_app();
    let org_id = OrgId::new();

    for payload in [
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
    ] {
        let req = json_request(
            "POST",
            &format!("/api/orgs/{org_id}/integrations"),
            Some(payload),
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/list_org_integrations"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed["integrations"].as_array().unwrap().len(), 11);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_list_repos"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let github_repos = response_json(resp).await;
    assert_eq!(github_repos["repos"][0]["full_name"], "octocat/hello-world");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_list_issues"),
        Some(serde_json::json!({
            "owner": "octocat",
            "repo": "hello-world"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let github_issues = response_json(resp).await;
    assert_eq!(github_issues["issues"][0]["number"], 42);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_create_issue"),
        Some(serde_json::json!({
            "owner": "octocat",
            "repo": "hello-world",
            "title": "Aura issue"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let github_issue = response_json(resp).await;
    assert_eq!(github_issue["issue"]["number"], 42);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_comment_issue"),
        Some(serde_json::json!({
            "owner": "octocat",
            "repo": "hello-world",
            "issue_number": "42",
            "body": "Ship it"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let github_comment = response_json(resp).await;
    assert_eq!(github_comment["comment"]["id"], 9001);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_list_pull_requests"),
        Some(serde_json::json!({
            "owner": "octocat",
            "repo": "hello-world"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let github_pulls = response_json(resp).await;
    assert_eq!(github_pulls["pull_requests"][0]["number"], 7);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/github_create_pull_request"),
        Some(serde_json::json!({
            "owner": "octocat",
            "repo": "hello-world",
            "title": "Aura PR",
            "head": "feature/aura",
            "base": "main"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let github_pr = response_json(resp).await;
    assert_eq!(github_pr["pull_request"]["number"], 7);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/linear_list_teams"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let linear_teams = response_json(resp).await;
    assert_eq!(linear_teams["teams"][0]["key"], "PLAT");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/linear_list_issues"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let linear_issues = response_json(resp).await;
    assert_eq!(linear_issues["issues"][0]["identifier"], "PLAT-42");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/linear_create_issue"),
        Some(serde_json::json!({
            "team_id": "team-1",
            "title": "Aura linear issue"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let linear_issue = response_json(resp).await;
    assert_eq!(linear_issue["issue"]["identifier"], "PLAT-42");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/linear_update_issue_status"),
        Some(serde_json::json!({
            "issue_id": "lin-1",
            "state_id": "state-2"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let linear_updated = response_json(resp).await;
    assert_eq!(linear_updated["issue"]["state"]["name"], "In Progress");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/linear_comment_issue"),
        Some(serde_json::json!({
            "issue_id": "lin-1",
            "body": "Looking good"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let linear_comment = response_json(resp).await;
    assert_eq!(linear_comment["comment"]["id"], "comment-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/slack_list_channels"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let slack_channels = response_json(resp).await;
    assert_eq!(slack_channels["channels"][0]["name"], "eng");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/slack_post_message"),
        Some(serde_json::json!({
            "channel_id": "C123",
            "text": "Ship it"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let slack_message = response_json(resp).await;
    assert_eq!(slack_message["message"]["channel"], "C123");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/notion_search_pages"),
        Some(serde_json::json!({
            "query": "Team"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let notion_pages = response_json(resp).await;
    assert_eq!(notion_pages["pages"][0]["title"], "Team Notes");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/notion_create_page"),
        Some(serde_json::json!({
            "parent_page_id": "page-1",
            "title": "Aura Page",
            "content": "First paragraph"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let notion_page = response_json(resp).await;
    assert_eq!(notion_page["page"]["id"], "page-2");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_web"),
        Some(serde_json::json!({
            "query": "aura"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let brave_web = response_json(resp).await;
    assert_eq!(brave_web["results"][0]["title"], "Brave result");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/brave_search_news"),
        Some(serde_json::json!({
            "query": "aura"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let brave_news = response_json(resp).await;
    assert_eq!(brave_news["results"][0]["title"], "Brave news");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/freepik_list_icons"),
        Some(serde_json::json!({
            "term": "cat"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let freepik_icons = response_json(resp).await;
    assert_eq!(freepik_icons["icons"][0]["slug"], "cat-icon");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/freepik_improve_prompt"),
        Some(serde_json::json!({
            "prompt": "cute cat mascot"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let freepik_prompt = response_json(resp).await;
    assert_eq!(freepik_prompt["task"]["task_id"], "task-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/freepik_generate_image"),
        Some(serde_json::json!({
            "prompt": "Aura mascot"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let freepik_images = response_json(resp).await;
    assert_eq!(freepik_images["images"][0]["has_nsfw"], false);

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/apify_list_actors"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let apify_actors = response_json(resp).await;
    assert_eq!(apify_actors["actors"][0]["id"], "actor-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/apify_run_actor"),
        Some(serde_json::json!({
            "actor_id": "my-actor",
            "input": { "query": "aura" }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let apify_run = response_json(resp).await;
    assert_eq!(apify_run["run"]["id"], "run-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/apify_get_run"),
        Some(serde_json::json!({
            "run_id": "run-1"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let apify_run_details = response_json(resp).await;
    assert_eq!(apify_run_details["run"]["default_dataset_id"], "dataset-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/apify_get_dataset_items"),
        Some(serde_json::json!({
            "dataset_id": "dataset-1"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let apify_items = response_json(resp).await;
    assert_eq!(apify_items["items"][0]["title"], "Aura result");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/apify_run_actor_get_dataset_items"),
        Some(serde_json::json!({
            "actor_id": "my-actor",
            "input": { "query": "aura" }
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let apify_sync_items = response_json(resp).await;
    assert_eq!(apify_sync_items["items"][0]["title"], "Sync result");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/metricool_list_brands"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let metricool_brands = response_json(resp).await;
    assert_eq!(metricool_brands["brands"][0]["label"], "Aura Brand");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/metricool_list_posts"),
        Some(serde_json::json!({
            "start": 1710000000,
            "end": 1710086400
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let metricool_posts = response_json(resp).await;
    assert_eq!(metricool_posts["posts"][0]["title"], "Metricool post");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/mailchimp_list_audiences"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mailchimp_lists = response_json(resp).await;
    assert_eq!(mailchimp_lists["audiences"][0]["id"], "list-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/mailchimp_list_campaigns"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mailchimp_campaigns = response_json(resp).await;
    assert_eq!(mailchimp_campaigns["campaigns"][0]["id"], "camp-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/mailchimp_list_members"),
        Some(serde_json::json!({
            "list_id": "list-1"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mailchimp_members = response_json(resp).await;
    assert_eq!(mailchimp_members["members"][0]["id"], "member-1");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/mailchimp_add_member"),
        Some(serde_json::json!({
            "list_id": "list-1",
            "email_address": "new@example.com"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mailchimp_member = response_json(resp).await;
    assert_eq!(mailchimp_member["member"]["id"], "member-2");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/mailchimp_get_campaign_content"),
        Some(serde_json::json!({
            "campaign_id": "camp-1"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let mailchimp_content = response_json(resp).await;
    assert_eq!(
        mailchimp_content["content"]["plain_text"],
        "Hello from Aura"
    );

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/resend_list_domains"),
        Some(serde_json::json!({})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resend_domains = response_json(resp).await;
    assert_eq!(resend_domains["domains"][0]["name"], "example.com");

    let req = json_request(
        "POST",
        &format!("/api/orgs/{org_id}/tool-actions/resend_send_email"),
        Some(serde_json::json!({
            "from": "Aura <ops@example.com>",
            "to": ["user@example.com"],
            "subject": "Aura test email",
            "html": "<p>Hello from Aura</p>"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let resend_email = response_json(resp).await;
    assert_eq!(resend_email["email"]["id"], "email-1");

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

// ---------------------------------------------------------------------------
// Task/Progress Endpoint Tests
// ---------------------------------------------------------------------------

// task_list_and_progress test removed -- requires seeding tasks via legacy local store
// which was removed in Phase 5e. Will be rewritten with aura-storage mock in Phase 9e.

#[tokio::test]
async fn spec_routes_support_storage_backed_crud() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "API Spec",
            "markdownContents": "# API Spec",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = response_json(resp).await;
    let spec_id = created["spec_id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "API Spec");

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["spec_id"], spec_id);

    let req = json_request(
        "GET",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let fetched = response_json(resp).await;
    assert_eq!(fetched["title"], "API Spec");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        Some(serde_json::json!({
            "title": "Updated API Spec",
            "markdownContents": "# Updated API Spec"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["title"], "Updated API Spec");
    assert_eq!(updated["markdown_contents"], "# Updated API Spec");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        Some(serde_json::json!({
            "markdown_contents": "# Updated Via Snake Case",
            "order_index": 3
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["markdown_contents"], "# Updated Via Snake Case");
    assert_eq!(updated["order_index"], 3);

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert!(listed.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn delete_spec_with_associated_tasks_returns_conflict() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "Spec With Tasks",
            "markdownContents": "# Spec",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let spec = response_json(resp).await;
    let spec_id = spec["spec_id"].as_str().unwrap().to_string();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "spec_id": spec_id.clone(),
            "title": "Blocking Task",
            "description": "Prevents spec deletion",
            "status": "pending",
            "order_index": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let task = response_json(resp).await;
    let task_id = task["task_id"].as_str().unwrap().to_string();

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "conflict");
    let msg = body["error"].as_str().unwrap_or_default();
    assert!(
        msg.contains("1 associated task"),
        "expected conflict message to mention the associated task, got: {msg}"
    );

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["spec_id"], spec_id);

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/tasks/{task_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn task_routes_support_storage_backed_crud_and_state_changes() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "Task Parent Spec",
            "markdownContents": "# Parent",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let spec = response_json(resp).await;
    let spec_id = spec["spec_id"].as_str().unwrap().to_string();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "spec_id": spec_id.clone(),
            "title": "Primary Task",
            "description": "Initial description",
            "status": "pending",
            "order_index": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = response_json(resp).await;
    let task_id = created["task_id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "Primary Task");
    assert_eq!(created["status"], "pending");

    let req = json_request("GET", &format!("/api/projects/{project_id}/tasks"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);

    let req = json_request(
        "GET",
        &format!("/api/projects/{project_id}/tasks/{task_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let fetched = response_json(resp).await;
    assert_eq!(fetched["description"], "Initial description");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}/tasks/{task_id}"),
        Some(serde_json::json!({
            "title": "Primary Task Updated",
            "description": "Updated description"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["title"], "Primary Task Updated");
    assert_eq!(updated["description"], "Updated description");

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks/{task_id}/transition"),
        Some(serde_json::json!({ "new_status": "ready" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let transitioned = response_json(resp).await;
    assert_eq!(transitioned["status"], "ready");

    let req = json_request(
        "GET",
        &format!("/api/projects/{project_id}/specs/{spec_id}/tasks"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let by_spec = response_json(resp).await;
    assert_eq!(by_spec.as_array().unwrap().len(), 1);
    assert_eq!(by_spec[0]["task_id"], task_id);

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "spec_id": spec_id.clone(),
            "title": "Retry Task",
            "description": "Should return to ready",
            "status": "failed",
            "order_index": 1
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let failed = response_json(resp).await;
    let failed_task_id = failed["task_id"].as_str().unwrap().to_string();
    assert_eq!(failed["status"], "failed");

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks/{failed_task_id}/retry"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let retried = response_json(resp).await;
    assert_eq!(retried["status"], "ready");

    for task_id in [&task_id, &failed_task_id] {
        let req = json_request(
            "DELETE",
            &format!("/api/projects/{project_id}/tasks/{task_id}"),
            None,
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    let req = json_request("GET", &format!("/api/projects/{project_id}/tasks"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert!(listed.as_array().unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Agent Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_list_empty() {
    let (app, _state, _db) = build_test_app_with_mocks().await;

    let pid = ProjectId::new();
    // Project agents come from storage only; mock storage returns empty list.
    let req = json_request("GET", &format!("/api/projects/{pid}/agents"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn agent_not_found() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let pid = ProjectId::new();
    let aid = AgentId::new();
    let req = json_request("GET", &format!("/api/projects/{pid}/agents/{aid}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Bad UUID in path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn bad_uuid_returns_400() {
    let (app, _, _db) = build_test_app();

    let req = json_request("GET", "/api/projects/not-a-uuid", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Dev Loop - no API key
// ---------------------------------------------------------------------------

#[tokio::test]
async fn loop_stop_without_running_is_idempotent() {
    // Stopping with nothing in the registry is a no-op that returns the
    // current (empty) status instead of a 4xx. This keeps the UI unstuck
    // when the harness has already self-terminated or another client raced
    // us to stop.
    let (app, _, _db) = build_test_app();

    let pid = ProjectId::new();
    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["running"], false);
    assert_eq!(body["paused"], false);
    assert_eq!(
        body["active_agent_instances"]
            .as_array()
            .map(|items| items.len()),
        Some(0)
    );
}

#[tokio::test]
async fn loop_stop_clears_registry_even_when_harness_unreachable() {
    // If the registry has a live entry but the harness at harness_base_url
    // is unreachable, `client.stop()` errors. The handler should still
    // remove the registry entry, emit `loop_stopped`, and return 200 so the
    // UI returns to the Run state instead of getting stuck on Pause/Stop.
    use aura_os_core::AgentInstanceId;
    use aura_os_server::ActiveAutomaton;

    let (app, state, _db) = build_test_app();

    let pid = ProjectId::new();
    let aiid = AgentInstanceId::new();
    // Point at a port nothing is listening on so the harness stop call fails.
    let unreachable_harness = "http://127.0.0.1:1".to_string();
    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            aiid,
            ActiveAutomaton {
                automaton_id: "auto-1".into(),
                project_id: pid,
                harness_base_url: unreachable_harness,
                paused: false,
                alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                forwarder: None,
            },
        );
    }

    let mut event_rx = state.event_broadcast.subscribe();

    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["running"], false);
    assert_eq!(
        body["active_agent_instances"]
            .as_array()
            .map(|items| items.len()),
        Some(0)
    );

    // Registry entry was removed despite the harness being unreachable.
    {
        let reg = state.automaton_registry.lock().await;
        assert!(reg.is_empty(), "registry should be cleared after stop");
    }

    // A `loop_stopped` domain event was broadcast so the UI reconciles.
    let event = tokio::time::timeout(std::time::Duration::from_secs(1), event_rx.recv())
        .await
        .expect("loop_stopped event should be emitted")
        .expect("broadcast channel should yield an event");
    assert_eq!(event["type"], "loop_stopped");
    assert_eq!(event["project_id"], pid.to_string());
    assert_eq!(event["agent_instance_id"], aiid.to_string());
}

// ---------------------------------------------------------------------------
// Error format consistency
// ---------------------------------------------------------------------------

#[tokio::test]
async fn error_format_has_error_and_code() {
    let (app, _, _db) = build_test_app();

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    let body = response_json(resp).await;

    assert!(body["error"].is_string());
    assert!(body["code"].is_string());
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cors_headers_present() {
    let (app, _, _db) = build_test_app();

    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/projects")
        .header("Origin", "http://localhost:3000")
        .header("Access-Control-Request-Method", "GET")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert!(resp.headers().contains_key("access-control-allow-origin"));
    assert_eq!(
        resp.headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:3000")
    );
    assert_eq!(
        resp.headers()
            .get("access-control-allow-credentials")
            .and_then(|value| value.to_str().ok()),
        Some("true")
    );
}
