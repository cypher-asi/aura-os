//! Provider runtime helpers.
//!
//! Resolves base URLs (including the Mailchimp server-prefix special
//! case), shapes saved secrets into [`InstalledToolRuntimeAuth`] /
//! [`InstalledToolRuntimeExecution`] payloads for the harness, and
//! builds outbound `reqwest` headers and authenticated URLs for direct
//! server-side calls into a provider.

use std::collections::HashMap;

use aura_os_harness::{
    InstalledToolRuntimeAuth, InstalledToolRuntimeExecution, InstalledToolRuntimeIntegration,
    InstalledToolRuntimeProviderExecution,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::Value;

use super::catalog::app_provider_request_contract;
use super::types::{AppProviderAuthScheme, AppProviderKind};

pub fn app_provider_base_url(kind: AppProviderKind) -> Option<String> {
    let contract = app_provider_request_contract(kind);
    let env_override = contract
        .env_base_url_key
        .and_then(std::env::var_os)
        .and_then(|value| value.into_string().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    env_override.or_else(|| {
        contract
            .default_base_url
            .map(|default_url| default_url.to_string())
    })
}

pub fn app_provider_runtime_auth(kind: AppProviderKind, secret: &str) -> InstalledToolRuntimeAuth {
    match app_provider_request_contract(kind).auth_scheme {
        AppProviderAuthScheme::None => InstalledToolRuntimeAuth::None,
        AppProviderAuthScheme::AuthorizationBearer => {
            InstalledToolRuntimeAuth::AuthorizationBearer {
                token: secret.to_string(),
            }
        }
        AppProviderAuthScheme::AuthorizationRaw => InstalledToolRuntimeAuth::AuthorizationRaw {
            value: secret.to_string(),
        },
        AppProviderAuthScheme::Header(name) => InstalledToolRuntimeAuth::Header {
            name: name.to_string(),
            value: secret.to_string(),
        },
        AppProviderAuthScheme::Basic { username } => InstalledToolRuntimeAuth::Basic {
            username: username.to_string(),
            password: secret.to_string(),
        },
        AppProviderAuthScheme::QueryParam(name) => InstalledToolRuntimeAuth::QueryParam {
            name: name.to_string(),
            value: secret.to_string(),
        },
    }
}

pub fn installed_tool_runtime_execution_for_provider(
    kind: AppProviderKind,
    integrations: Vec<InstalledToolRuntimeIntegration>,
) -> Option<InstalledToolRuntimeExecution> {
    let base_url = app_provider_base_url(kind).unwrap_or_default();
    let static_headers = app_provider_request_contract(kind)
        .static_headers
        .iter()
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect::<HashMap<_, _>>();
    Some(InstalledToolRuntimeExecution::AppProvider(
        InstalledToolRuntimeProviderExecution {
            provider: kind.provider_id().to_string(),
            base_url,
            static_headers,
            integrations,
        },
    ))
}

pub fn app_provider_headers(kind: AppProviderKind, secret: &str) -> Result<HeaderMap, String> {
    let contract = app_provider_request_contract(kind);
    let mut headers = default_json_headers();

    for (name, value) in contract.static_headers {
        headers.insert(*name, HeaderValue::from_static(value));
    }

    match contract.auth_scheme {
        AppProviderAuthScheme::None | AppProviderAuthScheme::QueryParam(_) => {}
        AppProviderAuthScheme::AuthorizationBearer => {
            let value = HeaderValue::from_str(&format!("Bearer {secret}"))
                .map_err(|e| format!("invalid bearer auth header: {e}"))?;
            headers.insert(AUTHORIZATION, value);
        }
        AppProviderAuthScheme::AuthorizationRaw => {
            let value = HeaderValue::from_str(secret)
                .map_err(|e| format!("invalid raw authorization header: {e}"))?;
            headers.insert(AUTHORIZATION, value);
        }
        AppProviderAuthScheme::Header(name) => {
            let value =
                HeaderValue::from_str(secret).map_err(|e| format!("invalid {name} header: {e}"))?;
            headers.insert(name, value);
        }
        AppProviderAuthScheme::Basic { username } => {
            let basic_auth = BASE64_STANDARD.encode(format!("{username}:{secret}"));
            let value = HeaderValue::from_str(&format!("Basic {basic_auth}"))
                .map_err(|e| format!("invalid basic auth header: {e}"))?;
            headers.insert(AUTHORIZATION, value);
        }
    }

    Ok(headers)
}

pub fn app_provider_authenticated_url(
    kind: AppProviderKind,
    path: &str,
    secret: &str,
) -> Result<reqwest::Url, String> {
    app_provider_authenticated_url_with_config(kind, path, secret, None)
}

pub fn app_provider_authenticated_url_with_config(
    kind: AppProviderKind,
    path: &str,
    secret: &str,
    provider_config: Option<&Value>,
) -> Result<reqwest::Url, String> {
    let base_url =
        app_provider_runtime_base_url(kind, secret, provider_config).ok_or_else(|| {
            format!(
                "provider `{}` does not define a base url",
                kind.provider_id()
            )
        })?;
    let mut url = reqwest::Url::parse(&format!("{base_url}{path}"))
        .map_err(|e| format!("invalid {} base url: {e}", kind.provider_id()))?;

    if let AppProviderAuthScheme::QueryParam(param) =
        app_provider_request_contract(kind).auth_scheme
    {
        url.query_pairs_mut().append_pair(param, secret);
    }

    Ok(url)
}

pub fn app_provider_runtime_base_url(
    kind: AppProviderKind,
    secret: &str,
    provider_config: Option<&Value>,
) -> Option<String> {
    if let Some(base_url) = app_provider_base_url(kind) {
        return Some(base_url);
    }

    match kind {
        AppProviderKind::Mailchimp => mailchimp_runtime_base_url(secret, provider_config),
        _ => None,
    }
}

fn mailchimp_runtime_base_url(secret: &str, provider_config: Option<&Value>) -> Option<String> {
    let server_prefix = provider_config
        .and_then(Value::as_object)
        .and_then(|config| config.get("serverPrefix"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            secret
                .rsplit('-')
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })?;
    Some(format!("https://{server_prefix}.api.mailchimp.com/3.0"))
}

fn default_json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::types::AppProviderKind;

    #[test]
    fn github_headers_use_bearer_and_static_headers() {
        let headers =
            app_provider_headers(AppProviderKind::Github, "ghp_test").expect("github headers");
        assert_eq!(
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer ghp_test")
        );
        assert_eq!(
            headers
                .get("X-GitHub-Api-Version")
                .and_then(|value| value.to_str().ok()),
            Some("2022-11-28")
        );
        assert_eq!(
            headers
                .get("User-Agent")
                .and_then(|value| value.to_str().ok()),
            Some("aura-os")
        );
    }

    #[test]
    fn linear_headers_use_raw_authorization() {
        let headers =
            app_provider_headers(AppProviderKind::Linear, "lin_test").expect("linear headers");
        assert_eq!(
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("lin_test")
        );
    }

    #[test]
    fn buffer_urls_use_query_token_auth() {
        let url =
            app_provider_authenticated_url(AppProviderKind::Buffer, "/profiles.json", "buf_test")
                .expect("buffer url");
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "access_token"),
            Some(("access_token".into(), "buf_test".into()))
        );
    }
}
