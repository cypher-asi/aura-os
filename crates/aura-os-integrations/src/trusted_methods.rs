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
                name: "buffer_list_profiles".to_string(),
                provider: "buffer".to_string(),
                description: "List Buffer profiles available through a saved org integration."
                    .to_string(),
                prompt_signature: "buffer_list_profiles(integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "integration_id": { "type": "string" } }
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestJson {
                    method: TrustedIntegrationHttpMethod::Get,
                    path: "/profiles.json".to_string(),
                    query: vec![],
                    body: vec![],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "profiles".to_string(),
                        pointer: None,
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("formatted_username", "/formatted_username"),
                            result_field("service", "/service"),
                            result_field("service_username", "/service_username"),
                        ],
                        extras: vec![],
                    },
                },
            },
            TrustedIntegrationMethodDefinition {
                name: "buffer_create_update".to_string(),
                provider: "buffer".to_string(),
                description: "Create a social update in Buffer through a saved org integration."
                    .to_string(),
                prompt_signature:
                    "buffer_create_update(profile_id, text, integration_id?)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "integration_id": { "type": "string" },
                        "profile_id": { "type": "string", "description": "Buffer profile id from buffer_list_profiles." },
                        "text": { "type": "string", "description": "Text to schedule in Buffer." }
                    },
                    "required": ["profile_id", "text"]
                }),
                runtime: TrustedIntegrationRuntimeSpec::RestForm {
                    method: TrustedIntegrationHttpMethod::Post,
                    path: "/updates/create.json".to_string(),
                    query: vec![],
                    body: vec![
                        arg_binding(&["text"], "text", TrustedIntegrationArgValueType::String, true, None),
                        arg_binding(
                            &["profile_id", "profileId"],
                            "profile_ids[]",
                            TrustedIntegrationArgValueType::String,
                            true,
                            None,
                        ),
                    ],
                    success_guard: TrustedIntegrationSuccessGuard::None,
                    result: TrustedIntegrationResultTransform::ProjectArray {
                        key: "updates".to_string(),
                        pointer: Some("/updates".to_string()),
                        fields: vec![
                            result_field("id", "/id"),
                            result_field("status", "/status"),
                            result_field("text", "/text"),
                            result_field("service", "/service"),
                        ],
                        extras: vec![TrustedIntegrationResultExtraField {
                            output: "success".to_string(),
                            pointer: "/success".to_string(),
                            default_value: Some(Value::Bool(false)),
                        }],
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
