//! JSON argument extraction helpers used by every provider tool.
//!
//! These are extracted from the previous monolithic `org_tools.rs`. They are
//! deliberately small, pure helpers so each provider module can pull just the
//! ones it needs without coupling to the dispatch layer.

use serde_json::Value;

use super::resolve::ResolvedOrgIntegration;
use crate::error::{ApiError, ApiResult};

pub(super) fn required_string(args: &Value, keys: &[&str]) -> ApiResult<String> {
    optional_string(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

pub(super) fn optional_string(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

#[allow(dead_code)]
pub(super) fn required_string_list(args: &Value, keys: &[&str]) -> ApiResult<Vec<String>> {
    optional_string_list(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

#[allow(dead_code)]
pub(super) fn optional_string_list(args: &Value, keys: &[&str]) -> Option<Vec<String>> {
    keys.iter().find_map(|key| {
        let value = args.get(*key)?;
        if let Some(single) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(vec![single.to_string()]);
        }
        value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
    })
}

pub(super) fn optional_positive_number(args: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_u64))
}

pub(super) fn integration_config_string(
    integration: &ResolvedOrgIntegration,
    key: &str,
) -> Option<String> {
    integration
        .metadata
        .provider_config
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|config| config.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
