//! Static catalog of app provider contracts and lookup helpers.
//!
//! Owns the canonical [`AppProviderContract`] table that drives how each
//! known provider's saved org integration is turned into outbound HTTP
//! requests, plus the small `_by_tool` / `_by_kind` lookup helpers that
//! callers use to resolve a contract from a tool name or
//! [`AppProviderKind`].

use crate::manifest::legacy_org_integration_tool_manifest_entries;
use crate::trusted_methods::trusted_integration_method_by_tool;

use super::types::{
    AppProviderAuthScheme, AppProviderContract, AppProviderKind, AppProviderRequestContract,
};

pub fn app_provider_contracts() -> &'static [AppProviderContract] {
    &[
        AppProviderContract {
            kind: AppProviderKind::Github,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_GITHUB_API_BASE_URL"),
                default_base_url: Some("https://api.github.com"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[
                    ("X-GitHub-Api-Version", "2022-11-28"),
                    ("User-Agent", "aura-os"),
                ],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Linear,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_LINEAR_API_BASE_URL"),
                default_base_url: Some("https://api.linear.app/graphql"),
                auth_scheme: AppProviderAuthScheme::AuthorizationRaw,
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Slack,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_SLACK_API_BASE_URL"),
                default_base_url: Some("https://slack.com/api"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Notion,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_NOTION_API_BASE_URL"),
                default_base_url: Some("https://api.notion.com/v1"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[("Notion-Version", "2022-06-28")],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::BraveSearch,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_BRAVE_SEARCH_API_BASE_URL"),
                default_base_url: Some("https://api.search.brave.com"),
                auth_scheme: AppProviderAuthScheme::Header("X-Subscription-Token"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Freepik,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_FREEPIK_API_BASE_URL"),
                default_base_url: Some("https://api.freepik.com"),
                auth_scheme: AppProviderAuthScheme::Header("x-freepik-api-key"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Buffer,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_BUFFER_API_BASE_URL"),
                default_base_url: Some("https://api.bufferapp.com/1"),
                auth_scheme: AppProviderAuthScheme::QueryParam("access_token"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Apify,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_APIFY_API_BASE_URL"),
                default_base_url: Some("https://api.apify.com/v2"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Metricool,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_METRICOOL_API_BASE_URL"),
                default_base_url: Some("https://app.metricool.com/api"),
                auth_scheme: AppProviderAuthScheme::Header("X-Mc-Auth"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Mailchimp,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_MAILCHIMP_API_BASE_URL"),
                default_base_url: None,
                auth_scheme: AppProviderAuthScheme::Basic {
                    username: "anystring",
                },
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Resend,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_RESEND_API_BASE_URL"),
                default_base_url: Some("https://api.resend.com"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[],
            },
        },
    ]
}

pub fn app_provider_contract_by_tool(tool_name: &str) -> Option<&'static AppProviderContract> {
    let provider = trusted_integration_method_by_tool(tool_name)
        .map(|method| method.provider.as_str())
        .or_else(|| {
            legacy_org_integration_tool_manifest_entries()
                .iter()
                .find(|entry| entry.name == tool_name)
                .and_then(|entry| entry.provider.as_deref())
        })?;
    app_provider_contracts()
        .iter()
        .find(|contract| contract.kind.provider_id() == provider)
}

pub fn app_provider_request_contract(kind: AppProviderKind) -> &'static AppProviderRequestContract {
    &app_provider_contracts()
        .iter()
        .find(|contract| contract.kind == kind)
        .expect("every app provider kind must have a request contract")
        .request
}
