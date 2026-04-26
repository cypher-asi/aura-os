//! Trusted Metricool integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the Metricool API on behalf of a saved org integration. The
//! `userId` and `blogId` query parameters are sourced from the saved
//! integration's provider config rather than the per-call input.

use serde_json::json;

use super::builders::{arg_binding, config_binding, result_field};
use super::types::{
    TrustedIntegrationArgValueType, TrustedIntegrationHttpMethod,
    TrustedIntegrationMethodDefinition, TrustedIntegrationResultTransform,
    TrustedIntegrationRuntimeSpec, TrustedIntegrationSuccessGuard,
};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
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
            prompt_signature: "metricool_list_posts(start?, end?, integration_id?)".to_string(),
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
    ]
}
