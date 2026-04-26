//! Trusted Freepik integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the Freepik API on behalf of a saved org integration. Covers
//! icon search, prompt improvement, and text-to-image generation.

use serde_json::json;

use super::builders::{arg_binding, result_field};
use super::types::{
    TrustedIntegrationArgValueType, TrustedIntegrationHttpMethod,
    TrustedIntegrationMethodDefinition, TrustedIntegrationResultExtraField,
    TrustedIntegrationResultTransform, TrustedIntegrationRuntimeSpec,
    TrustedIntegrationSuccessGuard,
};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
        TrustedIntegrationMethodDefinition {
            name: "freepik_list_icons".to_string(),
            provider: "freepik".to_string(),
            description: "List Freepik icons through a saved org integration.".to_string(),
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
    ]
}
