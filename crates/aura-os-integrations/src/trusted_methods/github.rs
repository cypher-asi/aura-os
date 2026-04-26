//! Trusted GitHub integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the GitHub API on behalf of a saved org integration.

use serde_json::json;

use super::builders::{arg_binding, result_field, static_binding};
use super::types::{
    TrustedIntegrationArgValueType, TrustedIntegrationHttpMethod,
    TrustedIntegrationMethodDefinition, TrustedIntegrationResultTransform,
    TrustedIntegrationRuntimeSpec, TrustedIntegrationSuccessGuard,
};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
        TrustedIntegrationMethodDefinition {
            name: "github_list_repos".to_string(),
            provider: "github".to_string(),
            description: "List GitHub repositories accessible through a saved org integration."
                .to_string(),
            prompt_signature: "github_list_repos(integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string", "description": "Optional org integration id when multiple GitHub integrations exist." }
                }
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/user/repos?per_page=20&sort=updated".to_string(),
                query: vec![],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectArray {
                    key: "repos".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("name", "/name"),
                        result_field("full_name", "/full_name"),
                        result_field("private", "/private"),
                        result_field("html_url", "/html_url"),
                        result_field("default_branch", "/default_branch"),
                        result_field("description", "/description"),
                    ],
                    extras: vec![],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "github_create_issue".to_string(),
            provider: "github".to_string(),
            description: "Create a GitHub issue through a saved org integration.".to_string(),
            prompt_signature: "github_create_issue(owner, repo, title, body?, integration_id?)"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "owner": { "type": "string", "description": "Repository owner or org name." },
                    "repo": { "type": "string", "description": "Repository name." },
                    "title": { "type": "string", "description": "Issue title." },
                    "body": { "type": "string", "description": "Optional markdown issue body." }
                },
                "required": ["owner", "repo", "title"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Post,
                path: "/repos/{owner}/{repo}/issues".to_string(),
                query: vec![],
                body: vec![
                    arg_binding(
                        &["title"],
                        "title",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["body", "markdown_contents", "markdownContents"],
                        "body",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                ],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectObject {
                    key: "issue".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("number", "/number"),
                        result_field("title", "/title"),
                        result_field("state", "/state"),
                        result_field("html_url", "/html_url"),
                    ],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "github_list_issues".to_string(),
            provider: "github".to_string(),
            description: "List GitHub issues for a repository through a saved org integration."
                .to_string(),
            prompt_signature: "github_list_issues(owner, repo, state?, integration_id?)"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "owner": { "type": "string" },
                    "repo": { "type": "string" },
                    "state": { "type": "string", "description": "open, closed, or all." }
                },
                "required": ["owner", "repo"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/repos/{owner}/{repo}/issues".to_string(),
                query: vec![
                    arg_binding(
                        &["state"],
                        "state",
                        TrustedIntegrationArgValueType::String,
                        false,
                        Some(json!("open")),
                    ),
                    static_binding("per_page", "20"),
                ],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectArray {
                    key: "issues".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("number", "/number"),
                        result_field("title", "/title"),
                        result_field("state", "/state"),
                        result_field("html_url", "/html_url"),
                        result_field("user_login", "/user/login"),
                    ],
                    extras: vec![],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "github_comment_issue".to_string(),
            provider: "github".to_string(),
            description: "Comment on a GitHub issue through a saved org integration.".to_string(),
            prompt_signature:
                "github_comment_issue(owner, repo, issue_number, body, integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "owner": { "type": "string" },
                    "repo": { "type": "string" },
                    "issue_number": { "type": "string" },
                    "body": { "type": "string" }
                },
                "required": ["owner", "repo", "issue_number", "body"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Post,
                path: "/repos/{owner}/{repo}/issues/{issue_number}/comments".to_string(),
                query: vec![],
                body: vec![arg_binding(
                    &["body"],
                    "body",
                    TrustedIntegrationArgValueType::String,
                    true,
                    None,
                )],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectObject {
                    key: "comment".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("id", "/id"),
                        result_field("html_url", "/html_url"),
                        result_field("body", "/body"),
                        result_field("user_login", "/user/login"),
                    ],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "github_list_pull_requests".to_string(),
            provider: "github".to_string(),
            description:
                "List GitHub pull requests for a repository through a saved org integration."
                    .to_string(),
            prompt_signature: "github_list_pull_requests(owner, repo, state?, integration_id?)"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "owner": { "type": "string" },
                    "repo": { "type": "string" },
                    "state": { "type": "string", "description": "open, closed, or all." }
                },
                "required": ["owner", "repo"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Get,
                path: "/repos/{owner}/{repo}/pulls".to_string(),
                query: vec![
                    arg_binding(
                        &["state"],
                        "state",
                        TrustedIntegrationArgValueType::String,
                        false,
                        Some(json!("open")),
                    ),
                    static_binding("per_page", "20"),
                ],
                body: vec![],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectArray {
                    key: "pull_requests".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("number", "/number"),
                        result_field("title", "/title"),
                        result_field("state", "/state"),
                        result_field("html_url", "/html_url"),
                        result_field("head_ref", "/head/ref"),
                        result_field("base_ref", "/base/ref"),
                    ],
                    extras: vec![],
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "github_create_pull_request".to_string(),
            provider: "github".to_string(),
            description: "Create a GitHub pull request through a saved org integration."
                .to_string(),
            prompt_signature:
                "github_create_pull_request(owner, repo, title, head, base, body?, integration_id?)"
                    .to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "owner": { "type": "string" },
                    "repo": { "type": "string" },
                    "title": { "type": "string" },
                    "head": { "type": "string", "description": "Source branch name." },
                    "base": { "type": "string", "description": "Target branch name." },
                    "body": { "type": "string" }
                },
                "required": ["owner", "repo", "title", "head", "base"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::RestJson {
                method: TrustedIntegrationHttpMethod::Post,
                path: "/repos/{owner}/{repo}/pulls".to_string(),
                query: vec![],
                body: vec![
                    arg_binding(
                        &["title"],
                        "title",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["head"],
                        "head",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["base"],
                        "base",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["body"],
                        "body",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                ],
                success_guard: TrustedIntegrationSuccessGuard::None,
                result: TrustedIntegrationResultTransform::ProjectObject {
                    key: "pull_request".to_string(),
                    pointer: None,
                    fields: vec![
                        result_field("number", "/number"),
                        result_field("title", "/title"),
                        result_field("state", "/state"),
                        result_field("html_url", "/html_url"),
                    ],
                },
            },
        },
    ]
}
