//! Provider type definitions.
//!
//! Defines the closed set of app provider kinds (`AppProviderKind`) and the
//! request contracts (`AppProviderContract`, `AppProviderRequestContract`,
//! `AppProviderAuthScheme`) that drive how a saved org integration's secret
//! is shaped into outbound HTTP requests by the rest of the provider layer.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppProviderKind {
    Github,
    Linear,
    Slack,
    Notion,
    BraveSearch,
    Freepik,
    Buffer,
    Apify,
    Metricool,
    Mailchimp,
    Resend,
}

#[derive(Clone, Copy, Debug)]
pub struct AppProviderContract {
    pub kind: AppProviderKind,
    pub trusted: bool,
    pub request: AppProviderRequestContract,
}

#[derive(Clone, Copy, Debug)]
pub struct AppProviderRequestContract {
    pub env_base_url_key: Option<&'static str>,
    pub default_base_url: Option<&'static str>,
    pub auth_scheme: AppProviderAuthScheme,
    pub static_headers: &'static [(&'static str, &'static str)],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppProviderAuthScheme {
    None,
    AuthorizationBearer,
    AuthorizationRaw,
    Header(&'static str),
    Basic { username: &'static str },
    QueryParam(&'static str),
}

impl AppProviderKind {
    pub fn provider_id(self) -> &'static str {
        match self {
            AppProviderKind::Github => "github",
            AppProviderKind::Linear => "linear",
            AppProviderKind::Slack => "slack",
            AppProviderKind::Notion => "notion",
            AppProviderKind::BraveSearch => "brave_search",
            AppProviderKind::Freepik => "freepik",
            AppProviderKind::Buffer => "buffer",
            AppProviderKind::Apify => "apify",
            AppProviderKind::Metricool => "metricool",
            AppProviderKind::Mailchimp => "mailchimp",
            AppProviderKind::Resend => "resend",
        }
    }
}
