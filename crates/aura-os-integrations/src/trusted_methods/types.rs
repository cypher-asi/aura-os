//! Trusted-integration runtime type definitions.
//!
//! These types describe one entry in the trusted-method allow-list:
//! its public `TrustedIntegrationMethodDefinition` shape (name,
//! provider, schema, prompt signature) and the
//! `TrustedIntegrationRuntimeSpec` payload that the trusted-runtime
//! dispatcher reads to actually execute the call (REST/GraphQL/Brave
//! Search/Resend send-email).

use serde::{Deserialize, Serialize};
use serde_json::Value;

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

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustedIntegrationSuccessGuard {
    #[default]
    None,
    SlackOk,
    GraphqlErrors,
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
