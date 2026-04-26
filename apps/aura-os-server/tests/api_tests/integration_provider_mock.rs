use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;

pub fn build_provider_mock() -> Router {
    Router::new()
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
        )
}
