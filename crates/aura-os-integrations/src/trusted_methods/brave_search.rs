//! Trusted Brave Search integration methods.
//!
//! Allow-listed verticals the trusted runtime is permitted to query
//! against Brave Search on behalf of a saved org integration. The
//! actual REST shape is owned by the [`TrustedIntegrationRuntimeSpec::BraveSearch`]
//! dispatcher rather than spelled out per-method here.

use serde_json::json;

use super::types::{TrustedIntegrationMethodDefinition, TrustedIntegrationRuntimeSpec};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
        TrustedIntegrationMethodDefinition {
            name: "brave_search_web".to_string(),
            provider: "brave_search".to_string(),
            description: "Search the web through a saved Brave Search org integration."
                .to_string(),
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
            description: "Search recent news through a saved Brave Search org integration."
                .to_string(),
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
    ]
}
