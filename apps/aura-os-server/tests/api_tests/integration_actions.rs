use axum::http::StatusCode;
use axum::Router;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

pub async fn assert_github_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_linear_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_slack_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_notion_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_brave_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_freepik_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_apify_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_metricool_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_mailchimp_actions(app: &Router, org_id: &OrgId) {
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
}

pub async fn assert_resend_actions(app: &Router, org_id: &OrgId) {
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
}
