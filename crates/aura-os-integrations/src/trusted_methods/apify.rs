//! Trusted Apify integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the Apify API on behalf of a saved org integration. Covers
//! actor discovery, run inspection, dataset retrieval, and start/run
//! actor flows (both async and sync get-dataset-items shorthand).

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
            description: "Get an Apify Actor run through a saved org integration.".to_string(),
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
            description: "Get Apify dataset items through a saved org integration.".to_string(),
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
            description: "Start an Apify Actor run through a saved org integration.".to_string(),
            prompt_signature: "apify_run_actor(actor_id, input?, integration_id?)".to_string(),
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
                body: vec![arg_binding(
                    &["input"],
                    "$",
                    TrustedIntegrationArgValueType::Json,
                    false,
                    Some(json!({})),
                )],
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
    ]
}
