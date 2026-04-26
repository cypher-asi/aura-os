//! Trusted Linear integration methods.
//!
//! Allow-listed GraphQL calls the trusted runtime is permitted to make
//! against the Linear API on behalf of a saved org integration.

use serde_json::json;

use super::builders::arg_binding;
use super::types::{
    TrustedIntegrationArgValueType, TrustedIntegrationMethodDefinition,
    TrustedIntegrationResultTransform, TrustedIntegrationRuntimeSpec,
    TrustedIntegrationSuccessGuard,
};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
        TrustedIntegrationMethodDefinition {
            name: "linear_list_teams".to_string(),
            provider: "linear".to_string(),
            description: "List Linear teams available through a saved org integration."
                .to_string(),
            prompt_signature: "linear_list_teams(integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "integration_id": { "type": "string" } }
            }),
            runtime: TrustedIntegrationRuntimeSpec::Graphql {
                query: "query AuraLinearTeams { teams { nodes { id name key } } }".to_string(),
                variables: vec![],
                success_guard: TrustedIntegrationSuccessGuard::GraphqlErrors,
                result: TrustedIntegrationResultTransform::WrapPointer {
                    key: "teams".to_string(),
                    pointer: "/data/teams/nodes".to_string(),
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "linear_create_issue".to_string(),
            provider: "linear".to_string(),
            description: "Create a Linear issue through a saved org integration.".to_string(),
            prompt_signature:
                "linear_create_issue(team_id, title, description?, integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "team_id": { "type": "string", "description": "Linear team id from linear_list_teams." },
                    "title": { "type": "string", "description": "Issue title." },
                    "description": { "type": "string", "description": "Optional issue description." }
                },
                "required": ["team_id", "title"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::Graphql {
                query: "mutation AuraLinearCreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url state { name } team { id name key } } } }".to_string(),
                variables: vec![
                    arg_binding(
                        &["team_id", "teamId"],
                        "input.teamId",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["title"],
                        "input.title",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["description", "body", "markdown_contents", "markdownContents"],
                        "input.description",
                        TrustedIntegrationArgValueType::String,
                        false,
                        None,
                    ),
                ],
                success_guard: TrustedIntegrationSuccessGuard::GraphqlErrors,
                result: TrustedIntegrationResultTransform::WrapPointer {
                    key: "issue".to_string(),
                    pointer: "/data/issueCreate/issue".to_string(),
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "linear_list_issues".to_string(),
            provider: "linear".to_string(),
            description: "List recent Linear issues through a saved org integration.".to_string(),
            prompt_signature: "linear_list_issues(integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "integration_id": { "type": "string" } }
            }),
            runtime: TrustedIntegrationRuntimeSpec::Graphql {
                query: "query AuraLinearIssues { issues(first: 20) { nodes { id identifier title url state { id name type } team { id name key } } } }".to_string(),
                variables: vec![],
                success_guard: TrustedIntegrationSuccessGuard::GraphqlErrors,
                result: TrustedIntegrationResultTransform::WrapPointer {
                    key: "issues".to_string(),
                    pointer: "/data/issues/nodes".to_string(),
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "linear_update_issue_status".to_string(),
            provider: "linear".to_string(),
            description: "Update a Linear issue status through a saved org integration."
                .to_string(),
            prompt_signature:
                "linear_update_issue_status(issue_id, state_id, integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "issue_id": { "type": "string" },
                    "state_id": { "type": "string" }
                },
                "required": ["issue_id", "state_id"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::Graphql {
                query: "mutation AuraLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title url state { id name type } } } }".to_string(),
                variables: vec![
                    arg_binding(
                        &["issue_id", "issueId"],
                        "id",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["state_id", "stateId"],
                        "input.stateId",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                ],
                success_guard: TrustedIntegrationSuccessGuard::GraphqlErrors,
                result: TrustedIntegrationResultTransform::WrapPointer {
                    key: "issue".to_string(),
                    pointer: "/data/issueUpdate/issue".to_string(),
                },
            },
        },
        TrustedIntegrationMethodDefinition {
            name: "linear_comment_issue".to_string(),
            provider: "linear".to_string(),
            description: "Comment on a Linear issue through a saved org integration.".to_string(),
            prompt_signature: "linear_comment_issue(issue_id, body, integration_id?)".to_string(),
            input_schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "integration_id": { "type": "string" },
                    "issue_id": { "type": "string" },
                    "body": { "type": "string" }
                },
                "required": ["issue_id", "body"]
            }),
            runtime: TrustedIntegrationRuntimeSpec::Graphql {
                query: "mutation AuraLinearCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body } } }".to_string(),
                variables: vec![
                    arg_binding(
                        &["issue_id", "issueId"],
                        "input.issueId",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                    arg_binding(
                        &["body"],
                        "input.body",
                        TrustedIntegrationArgValueType::String,
                        true,
                        None,
                    ),
                ],
                success_guard: TrustedIntegrationSuccessGuard::GraphqlErrors,
                result: TrustedIntegrationResultTransform::WrapPointer {
                    key: "comment".to_string(),
                    pointer: "/data/commentCreate/comment".to_string(),
                },
            },
        },
    ]
}
