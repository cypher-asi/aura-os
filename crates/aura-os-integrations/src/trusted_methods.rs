use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;

pub const TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY: &str = "trusted_integration_runtime";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedIntegrationMethodDefinition {
    pub name: String,
    pub provider: String,
    pub description: String,
    pub prompt_signature: String,
    pub input_schema: Value,
    pub runtime: TrustedIntegrationRuntimeSpec,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustedIntegrationHttpMethod {
    Get,
    Post,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustedIntegrationArgValueType {
    String,
    StringList,
    PositiveNumber,
    Json,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TrustedIntegrationArgSource {
    #[default]
    InputArgs,
    ProviderConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedIntegrationArgBinding {
    pub arg_names: Vec<String>,
    pub target: String,
    #[serde(default)]
    pub source: TrustedIntegrationArgSource,
    pub value_type: TrustedIntegrationArgValueType,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<Value>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustedIntegrationSuccessGuard {
    None,
    SlackOk,
    GraphqlErrors,
}

impl Default for TrustedIntegrationSuccessGuard {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedIntegrationResultField {
    pub output: String,
    pub pointer: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedIntegrationResultExtraField {
    pub output: String,
    pub pointer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TrustedIntegrationResultTransform {
    WrapPointer {
        key: String,
        pointer: String,
    },
    ProjectArray {
        key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pointer: Option<String>,
        fields: Vec<TrustedIntegrationResultField>,
        #[serde(default)]
        extras: Vec<TrustedIntegrationResultExtraField>,
    },
    ProjectObject {
        key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pointer: Option<String>,
        fields: Vec<TrustedIntegrationResultField>,
    },
    BraveSearch {
        vertical: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TrustedIntegrationRuntimeSpec {
    RestJson {
        method: TrustedIntegrationHttpMethod,
        path: String,
        #[serde(default)]
        query: Vec<TrustedIntegrationArgBinding>,
        #[serde(default)]
        body: Vec<TrustedIntegrationArgBinding>,
        #[serde(default)]
        success_guard: TrustedIntegrationSuccessGuard,
        result: TrustedIntegrationResultTransform,
    },
    RestForm {
        method: TrustedIntegrationHttpMethod,
        path: String,
        #[serde(default)]
        query: Vec<TrustedIntegrationArgBinding>,
        #[serde(default)]
        body: Vec<TrustedIntegrationArgBinding>,
        #[serde(default)]
        success_guard: TrustedIntegrationSuccessGuard,
        result: TrustedIntegrationResultTransform,
    },
    Graphql {
        query: String,
        #[serde(default)]
        variables: Vec<TrustedIntegrationArgBinding>,
        #[serde(default)]
        success_guard: TrustedIntegrationSuccessGuard,
        result: TrustedIntegrationResultTransform,
    },
    BraveSearch {
        vertical: String,
    },
    ResendSendEmail,
}

pub fn trusted_integration_methods() -> &'static [TrustedIntegrationMethodDefinition] {
    static METHODS: OnceLock<Vec<TrustedIntegrationMethodDefinition>> = OnceLock::new();
    METHODS.get_or_init(|| {
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
                prompt_signature:
                    "github_create_issue(owner, repo, title, body?, integration_id?)".to_string(),
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
                        arg_binding(&["title"], "title", TrustedIntegrationArgValueType::String, true, None),
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
                prompt_signature:
                    "github_list_issues(owner, repo, state?, integration_id?)".to_string(),
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
                description: "Comment on a GitHub issue through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "github_comment_issue(owner, repo, issue_number, body, integration_id?)"
                        .to_string(),
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
                prompt_signature:
                    "github_list_pull_requests(owner, repo, state?, integration_id?)"
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
                        arg_binding(&["title"], "title", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(&["head"], "head", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(&["base"], "base", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(&["body"], "body", TrustedIntegrationArgValueType::String, false, None),
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
                    "linear_create_issue(team_id, title, description?, integration_id?)"
                        .to_string(),
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
                        arg_binding(&["team_id", "teamId"], "input.teamId", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(&["title"], "input.title", TrustedIntegrationArgValueType::String, true, None),
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
                description: "List recent Linear issues through a saved org integration."
                    .to_string(),
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
                        arg_binding(&["issue_id", "issueId"], "id", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(&["state_id", "stateId"], "input.stateId", TrustedIntegrationArgValueType::String, true, None),
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
                description: "Comment on a Linear issue through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "linear_comment_issue(issue_id, body, integration_id?)".to_string(),
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
                        arg_binding(&["issue_id", "issueId"], "input.issueId", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(&["body"], "input.body", TrustedIntegrationArgValueType::String, true, None),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::GraphqlErrors,
                    result: TrustedIntegrationResultTransform::WrapPointer {
                        key: "comment".to_string(),
                        pointer: "/data/commentCreate/comment".to_string(),
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "apify_list_actors".to_string(),
                provider: "apify".to_string(),
                description: "List Apify Actors available through a saved org integration."
                    .to_string(),
                prompt_signature: "apify_list_actors(limit?, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "limit": { "type": "integer", "description": "Optional max actors to return." }
                    }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/acts".to_string(),
                    query: vec![
                        static_binding("my", "1"),
                        arg_binding(
                            &["limit"],
                            "limit",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            Some(json!(20)),
                        ),
                    ],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "actors".to_string(),
                        pointer: Some("/data/items".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("name", "/name"),
                            result_field("username", "/username"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "apify_get_run".to_string(),
                provider: "apify".to_string(),
                description: "Get an Apify Actor run through a saved org integration."
                    .to_string(),
                prompt_signature: "apify_get_run(run_id, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "run_id": { "type": "string" }
                    },
                    "required": ["run_id"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/actor-runs/{run_id}".to_string(),
                    query: vec![],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectObject {
                        key: "run".to_string(),
                        pointer: Some("/data".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("status", "/status"),
                            result_field("act_id", "/actId"),
                            result_field("default_dataset_id", "/defaultDatasetId"),
                        ],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "apify_get_dataset_items".to_string(),
                provider: "apify".to_string(),
                description: "Get Apify dataset items through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "apify_get_dataset_items(dataset_id, limit?, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "dataset_id": { "type": "string" },
                        "limit": { "type": "integer" }
                    },
                    "required": ["dataset_id"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/datasets/{dataset_id}/items".to_string(),
                    query: vec![
                        static_binding("clean", "1"),
                        arg_binding(
                            &["limit"],
                            "limit",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            Some(json!(20)),
                        ),
                    ],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::WrapPointer {
                        key: "items".to_string(),
                        pointer: "".to_string(),
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "apify_run_actor_get_dataset_items".to_string(),
                provider: "apify".to_string(),
                description:
                    "Run an Apify Actor synchronously and return dataset items through a saved org integration."
                        .to_string(),
                prompt_signature:
                    "apify_run_actor_get_dataset_items(actor_id, input?, limit?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "actor_id": { "type": "string" },
                        "input": { "description": "Optional JSON input for the actor run." },
                        "limit": { "type": "integer" }
                    },
                    "required": ["actor_id"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/acts/{actor_id}/run-sync-get-dataset-items".to_string(),
                    query: vec![
                        static_binding("clean", "1"),
                        arg_binding(
                            &["limit"],
                            "limit",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            Some(json!(20)),
                        ),
                    ],
                    body: vec![arg_binding(
                        &["input"],
                        "$",
                        TrustedIntegrationArgValueType::Json,
                        false,
                        Some(json!({})),
                    )],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::WrapPointer {
                        key: "items".to_string(),
                        pointer: "".to_string(),
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "apify_run_actor".to_string(),
                provider: "apify".to_string(),
                description: "Start an Apify Actor run through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "apify_run_actor(actor_id, input?, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "actor_id": { "type": "string", "description": "Apify Actor id or username/name pair." },
                        "input": { "description": "Optional JSON input for the actor run." }
                    },
                    "required": ["actor_id"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/acts/{actor_id}/runs".to_string(),
                    query: vec![],
                    body: vec![
                        arg_binding(
                            &["input"],
                            "$",
                            TrustedIntegrationArgValueType::Json,
                            false,
                            Some(json!({})),
                        ),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectObject {
                        key: "run".to_string(),
                        pointer: Some("/data".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("status", "/status"),
                            result_field("act_id", "/actId"),
                        ],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "slack_list_channels".to_string(),
                provider: "slack".to_string(),
                description: "List Slack channels available through a saved org integration."
                    .to_string(),
                prompt_signature: "slack_list_channels(integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "integration_id": { "type": "string" } }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/conversations.list".to_string(),
                    query: vec![
                        static_binding("types", "public_channel,private_channel"),
                        static_binding("exclude_archived", "true"),
                        static_binding("limit", "100"),
                    ],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::SlackOk,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "channels".to_string(),
                        pointer: Some("/channels".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("name", "/name"),
                            result_field("is_private", "/is_private"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "slack_post_message".to_string(),
                provider: "slack".to_string(),
                description: "Post a message to Slack through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "slack_post_message(channel_id, text, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "channel_id": { "type": "string", "description": "Slack channel id." },
                        "text": { "type": "string", "description": "Message text to send." }
                    },
                    "required": ["channel_id", "text"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/chat.postMessage".to_string(),
                    query: vec![],
                    body: vec![
                        arg_binding(
                            &["channel_id", "channelId"],
                            "channel",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        arg_binding(
                            &["text", "message"],
                            "text",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::SlackOk,
                    result: TrustedIntegrationResultTransform::ProjectObject {
                        key: "message".to_string(),
                        pointer: None,
                        fields: vec![
                            result_field("channel", "/channel"),
                            result_field("ts", "/ts"),
                        ],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "brave_search_web".to_string(),
                provider: "brave_search".to_string(),
                description:
                    "Search the web through a saved Brave Search org integration.".to_string(),
                prompt_signature:
                    "brave_search_web(query, count?, freshness?, country?, search_lang?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "query": { "type": "string", "description": "Search query." },
                        "count": { "type": "integer", "description": "Maximum number of results to return." },
                        "freshness": { "type": "string", "description": "Optional freshness filter such as pd, pw, pm, or py." },
                        "country": { "type": "string", "description": "Optional 2-letter country code." },
                        "search_lang": { "type": "string", "description": "Optional search language code." }
                    },
                    "required": ["query"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::BraveSearch {
                    vertical: "web".to_string(),
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "brave_search_news".to_string(),
                provider: "brave_search".to_string(),
                description:
                    "Search recent news through a saved Brave Search org integration.".to_string(),
                prompt_signature:
                    "brave_search_news(query, count?, freshness?, country?, search_lang?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "query": { "type": "string", "description": "News search query." },
                        "count": { "type": "integer", "description": "Maximum number of results to return." },
                        "freshness": { "type": "string", "description": "Optional freshness filter such as pd, pw, pm, or py." },
                        "country": { "type": "string", "description": "Optional 2-letter country code." },
                        "search_lang": { "type": "string", "description": "Optional search language code." }
                    },
                    "required": ["query"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::BraveSearch {
                    vertical: "news".to_string(),
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "freepik_list_icons".to_string(),
                provider: "freepik".to_string(),
                description: "List Freepik icons through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "freepik_list_icons(term?, slug?, page?, per_page?, order?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "term": { "type": "string", "description": "Optional search term." },
                        "slug": { "type": "string", "description": "Optional icon slug." },
                        "page": { "type": "integer", "description": "Optional result page." },
                        "per_page": { "type": "integer", "description": "Optional page size." },
                        "order": { "type": "string", "description": "Optional sort order." }
                    }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/v1/icons".to_string(),
                    query: vec![
                        arg_binding(
                            &["term", "query", "q"],
                            "term",
                            TrustedIntegrationArgValueType::String,
                            false,
                            None,
                        ),
                        arg_binding(
                            &["slug"],
                            "slug",
                            TrustedIntegrationArgValueType::String,
                            false,
                            None,
                        ),
                        arg_binding(
                            &["page"],
                            "page",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            Some(json!(1)),
                        ),
                        arg_binding(
                            &["per_page", "perPage", "limit"],
                            "per_page",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            Some(json!(20)),
                        ),
                        arg_binding(
                            &["order"],
                            "order",
                            TrustedIntegrationArgValueType::String,
                            false,
                            None,
                        ),
                    ],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "icons".to_string(),
                        pointer: Some("/data".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("name", "/name"),
                            result_field("slug", "/slug"),
                            result_field("family", "/family/name"),
                            result_field("style", "/style/name"),
                        ],
                        extras: vec![TrustedIntegrationResultExtraField {
                            output: "meta".to_string(),
                            pointer: "/meta".to_string(),
                            default_value: Some(json!({})),
                        }],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "freepik_improve_prompt".to_string(),
                provider: "freepik".to_string(),
                description:
                    "Improve a creative prompt with Freepik AI through a saved org integration."
                        .to_string(),
                prompt_signature:
                    "freepik_improve_prompt(prompt, type?, language?, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "prompt": { "type": "string", "description": "Prompt to improve." },
                        "type": { "type": "string", "description": "Optional generation type, defaults to image." },
                        "language": { "type": "string", "description": "Optional language hint." }
                    },
                    "required": ["prompt"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/v1/ai/improve-prompt".to_string(),
                    query: vec![],
                    body: vec![
                        arg_binding(
                            &["prompt"],
                            "prompt",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        arg_binding(
                            &["type"],
                            "type",
                            TrustedIntegrationArgValueType::String,
                            false,
                            Some(json!("image")),
                        ),
                        arg_binding(
                            &["language"],
                            "language",
                            TrustedIntegrationArgValueType::String,
                            false,
                            None,
                        ),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectObject {
                        key: "task".to_string(),
                        pointer: Some("/data".to_string()),
                        fields: vec![
                            result_field("task_id", "/task_id"),
                            result_field("status", "/status"),
                            result_field("generated", "/generated"),
                        ],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "freepik_generate_image".to_string(),
                provider: "freepik".to_string(),
                description: "Generate images with Freepik through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "freepik_generate_image(prompt, negative_prompt?, size?, num_images?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "prompt": { "type": "string" },
                        "negative_prompt": { "type": "string" },
                        "size": { "type": "string", "description": "Optional image size such as square_1_1." },
                        "num_images": { "type": "integer", "description": "Optional image count." }
                    },
                    "required": ["prompt"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/v1/ai/text-to-image".to_string(),
                    query: vec![],
                    body: vec![
                        arg_binding(
                            &["prompt"],
                            "prompt",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        arg_binding(
                            &["negative_prompt", "negativePrompt"],
                            "negative_prompt",
                            TrustedIntegrationArgValueType::String,
                            false,
                            None,
                        ),
                        arg_binding(
                            &["size"],
                            "image.size",
                            TrustedIntegrationArgValueType::String,
                            false,
                            Some(json!("square_1_1")),
                        ),
                        arg_binding(
                            &["num_images", "numImages"],
                            "num_images",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            Some(json!(1)),
                        ),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "images".to_string(),
                        pointer: Some("/data".to_string()),
                        fields: vec![
                            result_field("base64", "/base64"),
                            result_field("has_nsfw", "/has_nsfw"),
                        ],
                        extras: vec![TrustedIntegrationResultExtraField {
                            output: "meta".to_string(),
                            pointer: "/meta".to_string(),
                            default_value: Some(json!({})),
                        }],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "metricool_list_brands".to_string(),
                provider: "metricool".to_string(),
                description: "List Metricool brands available through a saved org integration."
                    .to_string(),
                prompt_signature: "metricool_list_brands(integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" }
                    }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/admin/simpleProfiles".to_string(),
                    query: vec![
                        config_binding(
                            &["userId"],
                            "userId",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        config_binding(
                            &["blogId"],
                            "blogId",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                    ],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "brands".to_string(),
                        pointer: None,
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("user_id", "/userId"),
                            result_field("label", "/label"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "metricool_list_posts".to_string(),
                provider: "metricool".to_string(),
                description:
                    "List Metricool posts for the configured brand through a saved org integration."
                        .to_string(),
                prompt_signature:
                    "metricool_list_posts(start?, end?, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "start": { "type": "integer", "description": "Optional start date in YYYYMMDD format." },
                        "end": { "type": "integer", "description": "Optional end date in YYYYMMDD format." }
                    }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/stats/posts".to_string(),
                    query: vec![
                        config_binding(
                            &["userId"],
                            "userId",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        config_binding(
                            &["blogId"],
                            "blogId",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        arg_binding(
                            &["start"],
                            "start",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            None,
                        ),
                        arg_binding(
                            &["end"],
                            "end",
                            TrustedIntegrationArgValueType::PositiveNumber,
                            false,
                            None,
                        ),
                    ],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "posts".to_string(),
                        pointer: None,
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("title", "/title"),
                            result_field("url", "/url"),
                            result_field("published", "/published"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "mailchimp_list_audiences".to_string(),
                provider: "mailchimp".to_string(),
                description: "List Mailchimp audiences through a saved org integration."
                    .to_string(),
                prompt_signature: "mailchimp_list_audiences(integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "integration_id": { "type": "string" } }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/lists".to_string(),
                    query: vec![],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "audiences".to_string(),
                        pointer: Some("/lists".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("name", "/name"),
                            result_field("member_count", "/stats/member_count"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "mailchimp_list_campaigns".to_string(),
                provider: "mailchimp".to_string(),
                description: "List Mailchimp campaigns through a saved org integration."
                    .to_string(),
                prompt_signature: "mailchimp_list_campaigns(integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "integration_id": { "type": "string" } }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/campaigns".to_string(),
                    query: vec![],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "campaigns".to_string(),
                        pointer: Some("/campaigns".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("status", "/status"),
                            result_field("title", "/settings/title"),
                            result_field("emails_sent", "/emails_sent"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "mailchimp_list_members".to_string(),
                provider: "mailchimp".to_string(),
                description: "List members for a Mailchimp audience through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "mailchimp_list_members(list_id, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "list_id": { "type": "string" }
                    },
                    "required": ["list_id"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/lists/{list_id}/members".to_string(),
                    query: vec![static_binding("count", "20")],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "members".to_string(),
                        pointer: Some("/members".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("email_address", "/email_address"),
                            result_field("status", "/status"),
                            result_field("full_name", "/full_name"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "mailchimp_add_member".to_string(),
                provider: "mailchimp".to_string(),
                description: "Add a member to a Mailchimp audience through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "mailchimp_add_member(list_id, email_address, status?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "list_id": { "type": "string" },
                        "email_address": { "type": "string" },
                        "status": { "type": "string", "description": "Defaults to subscribed." }
                    },
                    "required": ["list_id", "email_address"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/lists/{list_id}/members".to_string(),
                    query: vec![],
                    body: vec![
                        arg_binding(
                            &["email_address", "emailAddress"],
                            "email_address",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                        arg_binding(
                            &["status"],
                            "status",
                            TrustedIntegrationArgValueType::String,
                            false,
                            Some(json!("subscribed")),
                        ),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectObject {
                        key: "member".to_string(),
                        pointer: None,
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("email_address", "/email_address"),
                            result_field("status", "/status"),
                        ],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "mailchimp_get_campaign_content".to_string(),
                provider: "mailchimp".to_string(),
                description:
                    "Get Mailchimp campaign content through a saved org integration.".to_string(),
                prompt_signature:
                    "mailchimp_get_campaign_content(campaign_id, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "campaign_id": { "type": "string" }
                    },
                    "required": ["campaign_id"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/campaigns/{campaign_id}/content".to_string(),
                    query: vec![],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectObject {
                        key: "content".to_string(),
                        pointer: None,
                        fields: vec![
                            result_field("html", "/html"),
                            result_field("plain_text", "/plain_text"),
                        ],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "resend_list_domains".to_string(),
                provider: "resend".to_string(),
                description: "List Resend domains through a saved org integration.".to_string(),
                prompt_signature: "resend_list_domains(integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "integration_id": { "type": "string" } }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/domains".to_string(),
                    query: vec![],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "domains".to_string(),
                        pointer: Some("/data".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("name", "/name"),
                            result_field("status", "/status"),
                            result_field("created_at", "/created_at"),
                            result_field("region", "/region"),
                            result_field("capabilities", "/capabilities"),
                        ],
                        extras: vec![TrustedIntegrationResultExtraField {
                            output: "has_more".to_string(),
                            pointer: "/has_more".to_string(),
                            default_value: Some(Value::Bool(false)),
                        }],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "resend_send_email".to_string(),
                provider: "resend".to_string(),
                description: "Send an email through a saved Resend org integration.".to_string(),
                prompt_signature:
                    "resend_send_email(from, to, subject, html?, text?, cc?, bcc?, integration_id?)"
                        .to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "from": { "type": "string", "description": "RFC 5322 sender string." },
                        "to": {
                            "description": "Recipient email or array of recipient emails.",
                            "oneOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }]
                        },
                        "subject": { "type": "string" },
                        "html": { "type": "string" },
                        "text": { "type": "string" },
                        "cc": {
                            "oneOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }]
                        },
                        "bcc": {
                            "oneOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }]
                        }
                    },
                    "required": ["from", "to", "subject"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::ResendSendEmail,
            },
        ]
    })
}

pub fn trusted_integration_method_by_tool(
    tool_name: &str,
) -> Option<&'static TrustedIntegrationMethodDefinition> {
    trusted_integration_methods()
        .iter()
        .find(|method| method.name == tool_name)
}

pub fn is_trusted_integration_provider(provider: &str) -> bool {
    trusted_integration_methods()
        .iter()
        .any(|method| method.provider == provider)
}

fn arg_binding(
    arg_names: &[&str],
    target: &str,
    value_type: TrustedIntegrationArgValueType,
    required: bool,
    default_value: Option<Value>,
) -> TrustedIntegrationArgBinding {
    TrustedIntegrationArgBinding {
        arg_names: arg_names.iter().map(|name| (*name).to_string()).collect(),
        target: target.to_string(),
        source: TrustedIntegrationArgSource::InputArgs,
        value_type,
        required,
        default_value,
    }
}

fn config_binding(
    arg_names: &[&str],
    target: &str,
    value_type: TrustedIntegrationArgValueType,
    required: bool,
    default_value: Option<Value>,
) -> TrustedIntegrationArgBinding {
    TrustedIntegrationArgBinding {
        arg_names: arg_names.iter().map(|name| (*name).to_string()).collect(),
        target: target.to_string(),
        source: TrustedIntegrationArgSource::ProviderConfig,
        value_type,
        required,
        default_value,
    }
}

fn static_binding(target: &str, value: &str) -> TrustedIntegrationArgBinding {
    TrustedIntegrationArgBinding {
        arg_names: Vec::new(),
        target: target.to_string(),
        source: TrustedIntegrationArgSource::InputArgs,
        value_type: TrustedIntegrationArgValueType::String,
        required: false,
        default_value: Some(Value::String(value.to_string())),
    }
}

fn result_field(output: &str, pointer: &str) -> TrustedIntegrationResultField {
    TrustedIntegrationResultField {
        output: output.to_string(),
        pointer: pointer.to_string(),
    }
}
