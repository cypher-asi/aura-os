//! Installed-tool and installed-integration wire definitions.
//!
//! These are the self-contained, wire-compatible mirrors of
//! `aura_core::InstalledToolDefinition` (and friends). Keeping them in this
//! crate without an `aura-core` dependency means clients can construct
//! `SessionInit` payloads on their own.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(feature = "typescript")]
use ts_rs::TS;

/// Authentication configuration for installed tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[derive(Default)]
pub enum ToolAuth {
    #[default]
    None,
    Bearer {
        token: String,
    },
    ApiKey {
        header: String,
        key: String,
    },
    Headers {
        headers: HashMap<String, String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InstalledToolRuntimeAuth {
    #[default]
    None,
    AuthorizationBearer {
        token: String,
    },
    AuthorizationRaw {
        value: String,
    },
    Header {
        name: String,
        value: String,
    },
    QueryParam {
        name: String,
        value: String,
    },
    Basic {
        username: String,
        password: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledToolRuntimeIntegration {
    pub integration_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default)]
    pub auth: InstalledToolRuntimeAuth,
    #[serde(default)]
    pub provider_config: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledToolRuntimeProviderExecution {
    pub provider: String,
    pub base_url: String,
    #[serde(default)]
    pub static_headers: HashMap<String, String>,
    #[serde(default)]
    pub integrations: Vec<InstalledToolRuntimeIntegration>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InstalledToolRuntimeExecution {
    AppProvider(InstalledToolRuntimeProviderExecution),
}

/// Definition for an installed tool, sent over the wire in `session_init`.
///
/// Wire-compatible with `aura_core::InstalledToolDefinition` but
/// self-contained so this crate has no dependency on `aura-core`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledToolIntegrationRequirement {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub endpoint: String,
    #[serde(default)]
    pub auth: ToolAuth,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_integration: Option<InstalledToolIntegrationRequirement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_execution: Option<InstalledToolRuntimeExecution>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Definition for an installed integration, sent over the wire in `session_init`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct InstalledIntegration {
    pub integration_id: String,
    pub name: String,
    pub provider: String,
    pub kind: String,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}
