//! Trusted Resend integration methods.
//!
//! Allow-listed REST calls the trusted runtime is permitted to make
//! against the Resend API on behalf of a saved org integration. The
//! `send_email` method uses a dedicated dispatcher
//! ([`TrustedIntegrationRuntimeSpec::ResendSendEmail`]) because the
//! request body shape and recipient normalisation are owned by that
//! handler rather than spelled out as field bindings here.

use serde_json::{json, Value};

use super::builders::result_field;
use super::types::{
    TrustedIntegrationHttpMethod, TrustedIntegrationMethodDefinition,
    TrustedIntegrationResultExtraField, TrustedIntegrationResultTransform,
    TrustedIntegrationRuntimeSpec, TrustedIntegrationSuccessGuard,
};

pub(crate) fn methods() -> Vec<TrustedIntegrationMethodDefinition> {
    vec![
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
}
