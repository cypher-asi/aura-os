//! Trusted Mailchimp integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the Mailchimp API on behalf of a saved org integration. Note
//! that the Mailchimp base URL is server-prefix-dependent; that
//! resolution lives in [`crate::provider::app_provider_runtime_base_url`].

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
            name: "mailchimp_list_audiences".to_string(),
            provider: "mailchimp".to_string(),
            description: "List Mailchimp audiences through a saved org integration.".to_string(),
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
            description: "List Mailchimp campaigns through a saved org integration.".to_string(),
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
            prompt_signature: "mailchimp_list_members(list_id, integration_id?)".to_string(),
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
                "mailchimp_add_member(list_id, email_address, status?, integration_id?)".to_string(),
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
            description: "Get Mailchimp campaign content through a saved org integration."
                .to_string(),
            prompt_signature: "mailchimp_get_campaign_content(campaign_id, integration_id?)"
                .to_string(),
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
    ]
}
