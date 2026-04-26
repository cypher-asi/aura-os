//! App provider abstractions.
//!
//! Owns the closed [`AppProviderKind`] enum, the contract types that
//! describe how each provider's saved org integration is shaped into
//! outbound requests, the static contract catalog, and the runtime
//! helpers that consumers (server handlers, harness manifest builder)
//! use to turn a provider + secret into headers / URLs / runtime
//! execution payloads.

mod catalog;
mod runtime;
mod types;

pub use catalog::{
    app_provider_contract_by_tool, app_provider_contracts, app_provider_request_contract,
};
pub use runtime::{
    app_provider_authenticated_url, app_provider_authenticated_url_with_config,
    app_provider_base_url, app_provider_headers, app_provider_runtime_auth,
    app_provider_runtime_base_url, installed_tool_runtime_execution_for_provider,
};
pub use types::{
    AppProviderAuthScheme, AppProviderContract, AppProviderKind, AppProviderRequestContract,
};
