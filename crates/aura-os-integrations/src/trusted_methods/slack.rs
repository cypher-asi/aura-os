//! Trusted Slack integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the Slack Web API on behalf of a saved org integration.

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
            description: "Post a message to Slack through a saved org integration.".to_string(),
            prompt_signature: "slack_post_message(channel_id, text, integration_id?)".to_string(),
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
    ]
}
