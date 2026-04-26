//! aura-os-integrations
//!
//! Crate-level abstractions for org integrations:
//! - [`IntegrationsClient`]: HTTP client for the optional aura-integrations
//!   microservice (canonical org-integration storage / secret resolution).
//! - [`provider`]: app provider catalog (kinds, request contracts, runtime
//!   helpers for headers / URLs / auth shaping).
//! - [`trusted_methods`]: per-provider allow-list of safe API calls the
//!   trusted-runtime path is permitted to dispatch.
//! - [`manifest`]: shared `org-integration-tools.json` view, merged with the
//!   trusted-method catalog.
//! - [`workspace_tools`]: builders that turn an org's enabled integrations
//!   into [`InstalledTool`] / [`InstalledIntegration`] payloads for the
//!   harness.
//! - [`control_plane_api_base_url`] (+ fallible variant): the base URL the
//!   server advertises for harness self-callbacks.
//!
//! [`InstalledTool`]: aura_os_harness::InstalledTool
//! [`InstalledIntegration`]: aura_os_harness::InstalledIntegration

pub mod client;
pub mod control_plane;
pub mod error;
pub mod manifest;
pub mod provider;
pub mod trusted_methods;
pub mod workspace_tools;

pub use client::IntegrationsClient;
pub use control_plane::{
    control_plane_api_base_url, control_plane_api_base_url_or_error, ControlPlaneBaseUrlError,
};
pub use error::IntegrationsError;
pub use manifest::{org_integration_tool_manifest_entries, OrgIntegrationToolManifestEntry};
pub use provider::{
    app_provider_authenticated_url, app_provider_authenticated_url_with_config,
    app_provider_base_url, app_provider_contract_by_tool, app_provider_contracts,
    app_provider_headers, app_provider_request_contract, app_provider_runtime_auth,
    app_provider_runtime_base_url, installed_tool_runtime_execution_for_provider,
    AppProviderAuthScheme, AppProviderContract, AppProviderKind, AppProviderRequestContract,
};
pub use trusted_methods::{
    is_trusted_integration_provider, trusted_integration_method_by_tool,
    trusted_integration_methods, TrustedIntegrationArgBinding, TrustedIntegrationArgValueType,
    TrustedIntegrationHttpMethod, TrustedIntegrationMethodDefinition,
    TrustedIntegrationResultExtraField, TrustedIntegrationResultField,
    TrustedIntegrationResultTransform, TrustedIntegrationRuntimeSpec,
    TrustedIntegrationSuccessGuard, TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY,
};
pub use workspace_tools::{installed_workspace_app_tools, installed_workspace_integrations};
