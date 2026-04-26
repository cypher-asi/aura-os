//! Trusted-integration method catalog.
//!
//! The trusted runtime path is only allowed to dispatch calls that
//! match an entry in this catalog. Each provider family has its own
//! file (`github.rs`, `linear.rs`, `slack.rs`, …); shared shapes live
//! in [`types`] and the small typed builders that assemble them live
//! in [`builders`].
//!
//! [`trusted_integration_methods`] returns the merged static slice the
//! rest of the crate uses for lookups; [`trusted_integration_method_by_tool`]
//! and [`is_trusted_integration_provider`] are convenience accessors over
//! that slice.

mod apify;
mod brave_search;
mod builders;
mod freepik;
mod github;
mod linear;
mod mailchimp;
mod metricool;
mod resend;
mod slack;
mod types;

pub use types::{
    TrustedIntegrationArgBinding, TrustedIntegrationArgSource, TrustedIntegrationArgValueType,
    TrustedIntegrationHttpMethod, TrustedIntegrationMethodDefinition,
    TrustedIntegrationResultExtraField, TrustedIntegrationResultField,
    TrustedIntegrationResultTransform, TrustedIntegrationRuntimeSpec,
    TrustedIntegrationSuccessGuard, TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY,
};

use std::sync::OnceLock;

/// Static, merged catalog of every trusted integration method we recognise.
///
/// The slice is built once on first access and kept for the life of the
/// process. Order is preserved across provider families to match the
/// historical layout of the previous monolithic table.
pub fn trusted_integration_methods() -> &'static [TrustedIntegrationMethodDefinition] {
    static METHODS: OnceLock<Vec<TrustedIntegrationMethodDefinition>> = OnceLock::new();
    METHODS.get_or_init(build_method_catalog)
}

fn build_method_catalog() -> Vec<TrustedIntegrationMethodDefinition> {
    let mut methods = Vec::new();
    methods.extend(github::methods());
    methods.extend(linear::methods());
    methods.extend(apify::methods());
    methods.extend(slack::methods());
    methods.extend(brave_search::methods());
    methods.extend(freepik::methods());
    methods.extend(metricool::methods());
    methods.extend(mailchimp::methods());
    methods.extend(resend::methods());
    methods
}

pub fn trusted_integration_method_by_tool(
    tool_name: &str,
) -> Option<&'static TrustedIntegrationMethodDefinition> {
    trusted_integration_methods()
        .iter()
        .find(|method| method.name == tool_name)
}

pub fn is_trusted_integration_provider(provider: &str) -> bool {
    trusted_integration_methods()
        .iter()
        .any(|method| method.provider == provider)
}
