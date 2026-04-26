//! Small typed constructors used by every per-provider method table.
//!
//! Keeping these in one place stops each provider file from
//! re-implementing the same `arg_names: arg_names.iter().map(...)`
//! boilerplate, and makes the `source` / `default_value` defaults
//! consistent across the catalog.

use serde_json::Value;

use super::types::{
    TrustedIntegrationArgBinding, TrustedIntegrationArgSource, TrustedIntegrationArgValueType,
    TrustedIntegrationResultField,
};

pub(crate) fn arg_binding(
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

pub(crate) fn config_binding(
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

pub(crate) fn static_binding(target: &str, value: &str) -> TrustedIntegrationArgBinding {
    TrustedIntegrationArgBinding {
        arg_names: Vec::new(),
        target: target.to_string(),
        source: TrustedIntegrationArgSource::InputArgs,
        value_type: TrustedIntegrationArgValueType::String,
        required: false,
        default_value: Some(Value::String(value.to_string())),
    }
}

pub(crate) fn result_field(output: &str, pointer: &str) -> TrustedIntegrationResultField {
    TrustedIntegrationResultField {
        output: output.to_string(),
        pointer: pointer.to_string(),
    }
}
